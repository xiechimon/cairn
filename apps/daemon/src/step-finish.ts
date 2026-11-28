import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentSessionHandle,
  type CommitIdentity,
  type ProviderConfig,
  WORKFLOW_PUSH_REFUSAL,
} from '@cairn/shared';
import type { AskChannel } from './ask-channel.js';
import { deliverStepOutcome, type StepDeliveryInput } from './step-deliver.js';
import type { StepGitRunner } from './step-git-tools.js';
import type { StepPassState } from './step-pass-events.js';
import { resolveStepPassOutcome, rewindAfterStep } from './step-pass-outcome.js';
import { settleStepGit } from './step-settle-git.js';
import type { RunStop } from './step-stops.js';
import type { StepTranscriptStream } from './step-transcript-stream.js';
import type { StreamWatchdog } from './stream-watchdog.js';

export interface StepFinishInput
  extends Omit<
    StepDeliveryInput,
    | 'session'
    | 'usage'
    | 'lastError'
    | 'failureCode'
    | 'failureDetail'
    | 'stopped'
    | 'quotaBlock'
    | 'git'
  > {
  passState: StepPassState;
  handle: AgentSessionHandle | null;
  continueId: string | null;
  provider: ProviderConfig | null;
  stream: StepTranscriptStream;
  watchdog: StreamWatchdog;
  askChannel: AskChannel;
  stop: RunStop;
  forgetHandle: () => void;
  stopHeartbeat: () => void;
  headAtStart: string | null;
  stepStartMs: number;
  reviewCheckout: boolean;
  appIdentity: CommitIdentity | null;
  identity: CommitIdentity;
  runGit: StepGitRunner;
  env?: NodeJS.ProcessEnv;
  now: () => number;
  reap?: () => Promise<void>;
  noRepoFilesBefore?: ReadonlyMap<string, string> | null;
}

const SNAPSHOT_MAX_ENTRIES = 10_000;
const SNAPSHOT_HASH_MAX_BYTES = 65_536;

export function snapshotWorkspaceFiles(cwd: string): Map<string, string> {
  const entries = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    if (entries.size >= SNAPSHOT_MAX_ENTRIES) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (entries.size >= SNAPSHOT_MAX_ENTRIES) return;
      if (name.startsWith('.cairn') || name === '.git' || name === 'node_modules') continue;
      const full = join(dir, name);
      const rel = prefix === '' ? name : `${prefix}/${name}`;
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!st.isFile()) continue;
      let fp = `${st.size}:${st.mtimeMs}`;
      if (st.size <= SNAPSHOT_HASH_MAX_BYTES) {
        try {
          const sha = createHash('sha1').update(readFileSync(full)).digest('hex');
          fp = `${st.size}:${st.mtimeMs}:${sha}`;
        } catch {
          void 0;
        }
      }
      entries.set(rel, fp);
    }
  };
  walk(cwd, '');
  return entries;
}

function hasWorkspaceFileChanges(before: ReadonlyMap<string, string>, cwd: string): boolean {
  const after = snapshotWorkspaceFiles(cwd);
  if (after.size !== before.size) return true;
  for (const [path, fp] of after) {
    if (before.get(path) !== fp) return true;
  }
  return false;
}

export async function finishStepRun(input: StepFinishInput): Promise<void> {
  const {
    passState,
    handle,
    stream,
    watchdog,
    logger,
    ws,
    stepId,
    transcript,
    now,
    isReview,
    attachmentVerify,
  } = input;
  input.forgetHandle();
  await stream.segments.seal();
  stream.flushDeltas();
  input.stopHeartbeat();
  watchdog.stop();
  input.askChannel.abort();
  await input.reap?.();
  const stopReq = input.stop.settle();
  const outcome = resolveStepPassOutcome({
    pass: passState,
    timeoutText: watchdog.message(),
    timeoutMs: watchdog.trippedTimeoutMs?.() ?? null,
    watchdogTripped: watchdog.trippedArm !== null,
    stopRequest: stopReq,
    provider: input.provider,
    log: (message) => logger.step(message),
  });
  const { stopped, quotaBlock } = outcome;
  const usage = !passState.sawDone && handle !== null ? handle.usage() : passState.usage;

  await rewindAfterStep({
    workspace: input.workspace,
    ws,
    headAtStart: input.headAtStart,
    attachmentVerify,
    stopped,
    stopRequest: stopReq,
    reviewCheckout: input.reviewCheckout,
    stepId,
    transcript,
    now,
    log: (message) => logger.step(message),
  });

  const noRepoDiskChanged =
    ws === null &&
    !isReview &&
    !attachmentVerify &&
    input.noRepoFilesBefore != null &&
    hasWorkspaceFileChanges(input.noRepoFilesBefore, input.cwd);

  const settledGit = await settleStepGit({
    git: input.workspace,
    ws,
    claimed: input.claimed,
    stepId,
    appIdentity: input.appIdentity,
    identity: input.identity,
    mergeCredential: input.repo?.kind === 'hosted' ? input.creds.git : null,
    headAtStart: input.headAtStart,
    stepStartMs: input.stepStartMs,
    runGit: input.runGit,
    headCommit: attachmentVerify ? input.headAtStart : null,
    hasChanges: isReview || attachmentVerify ? false : passState.sawChangeTool || noRepoDiskChanged,
    lastError: outcome.lastError,
    stopped,
    closes: outcome.lastError === null && !stopped && !isReview && !attachmentVerify,
    env: input.env,
    note: (id, content) =>
      transcript.upsert({
        id,
        role: 'system',
        content,
        createdAt: transcript.messages().find((m) => m.id === id)?.createdAt ?? now(),
      }),
    log: (message) => logger.step(message),
    logRaw: (message) => logger.raw(message),
  });
  const { lastError, ...git } = settledGit;
  const gitOverwroteError = lastError !== outcome.lastError;
  const failureCode = gitOverwroteError ? null : outcome.failureCode;
  const failureDetail = gitOverwroteError ? null : outcome.failureDetail;

  await deliverStepOutcome({
    client: input.client,
    journal: input.journal,
    logger,
    workspace: input.workspace,
    outboxDir: input.outboxDir,
    plansDir: input.plansDir,
    stepId,
    claimed: input.claimed,
    convId: input.convId,
    cwd: input.cwd,
    ws,
    repo: input.repo,
    creds: input.creds,
    credentialValues: input.credentialValues,
    refreshGitToken: input.refreshGitToken,
    transcript,
    session: { sessionId: handle?.sessionId ?? input.continueId, sessionFile: handle?.sessionFile },
    usage,
    lastError,
    failureCode,
    failureDetail,
    stopped,
    isReview,
    attachmentVerify,
    quotaBlock: lastError === WORKFLOW_PUSH_REFUSAL ? null : quotaBlock,
    skillInjectionFacts: input.skillInjectionFacts,
    uploadedEvidence: input.uploadedEvidence,
    git,
    running: input.running,
  });
}
