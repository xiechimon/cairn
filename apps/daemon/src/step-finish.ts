import type {
  AgentSessionHandle,
  CommitIdentity,
  GitIdentity,
  ProviderConfig,
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
    'session' | 'usage' | 'lastError' | 'stopped' | 'quotaBlock' | 'git'
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
  readonlyWorkspace: boolean;
  coAuthor: GitIdentity | null;
  appIdentity: CommitIdentity | null;
  identity: CommitIdentity;
  runGit: StepGitRunner;
  now: () => number;
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
  const stopReq = input.stop.settle();
  const outcome = resolveStepPassOutcome({
    pass: passState,
    timeoutText: watchdog.message(),
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

  const settledGit = await settleStepGit({
    git: input.workspace,
    ws,
    claimed: input.claimed,
    stepId,
    coAuthor: input.coAuthor,
    appIdentity: input.appIdentity,
    identity: input.identity,
    mergeCredential: input.creds.git,
    headAtStart: input.headAtStart,
    stepStartMs: input.stepStartMs,
    runGit: input.runGit,
    headCommit: attachmentVerify ? input.headAtStart : null,
    hasChanges:
      isReview || attachmentVerify || input.readonlyWorkspace ? false : passState.sawChangeTool,
    lastError: outcome.lastError,
    stopped,
    closes: outcome.lastError === null && !stopped && !isReview && !attachmentVerify,
    note: (id, content) => transcript.upsert({ id, role: 'system', content, createdAt: now() }),
    log: (message) => logger.step(message),
    logRaw: (message) => logger.raw(message),
  });
  const { lastError, ...git } = settledGit;

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
    stopped,
    isReview,
    attachmentVerify,
    infoReportFile: input.infoReportFile,
    quotaBlock,
    skillInjectionFacts: input.skillInjectionFacts,
    uploadedEvidence: input.uploadedEvidence,
    git,
    running: input.running,
  });
}
