import { join } from 'node:path';
import type {
  AgentTokenUsage,
  ClaimedStep,
  PreparedWorkspace,
  QuotaBlock,
  SkillInjectionFacts,
  WorktreeOps,
} from '@cairn/shared';
import { prepareCredentialSessionUpload } from './credential-output.js';
import { clearCredentials, type StepCredentials } from './credentials.js';
import type { StepJournal, TranscriptBuffer } from './journal.js';
import type { DaemonLogger } from './log.js';
import type { MachineApi } from './machine-client.js';
import { composeDoneBody } from './step-done-body.js';
import { putFinalArtifacts } from './step-final-upload.js';
import { readDeliveredPlan, readInfoReport } from './step-outputs.js';
import { boundedChangesDiff, probeStepPr } from './step-pr-probe.js';

type StepRepo = NonNullable<NonNullable<ClaimedStep['project']>['repo']>;

export interface StepDeliveryInput {
  client: MachineApi;
  journal: StepJournal;
  logger: DaemonLogger;
  workspace: WorktreeOps | undefined;
  outboxDir: string;
  plansDir: string;
  stepId: string;
  claimed: ClaimedStep;
  convId: string;
  cwd: string;
  ws: PreparedWorkspace | null;
  repo: StepRepo | null;
  creds: StepCredentials;
  credentialValues: readonly (string | undefined)[];
  refreshGitToken: (() => Promise<string>) | null;
  transcript: TranscriptBuffer;
  session: { sessionId: string | null; sessionFile: string | undefined };
  usage: AgentTokenUsage;
  lastError: string | null;
  stopped: boolean;
  isReview: boolean;
  attachmentVerify: boolean;
  infoReportFile: string | null;
  quotaBlock: QuotaBlock | null;
  skillInjectionFacts: SkillInjectionFacts | null;
  uploadedEvidence: ReadonlySet<string>;
  git: {
    headCommit: string | null;
    branchDrift: { expected: string; actual: string } | null;
    artifactBranches: readonly string[];
    hasChanges: boolean;
    pushHookOutput: string | null;
    preservedCommits: string[];
  };
  running: number;
}

interface StepChanges {
  prProbe: { number: number; url: string } | null;
  changesDiff: string | null;
}

async function probeStepChanges(
  input: StepDeliveryInput,
  ws: PreparedWorkspace,
  repo: StepRepo,
): Promise<StepChanges> {
  const log = (message: string) => input.logger.step(message);
  const { git } = input;
  const prProbe =
    repo.kind === 'github'
      ? await probeStepPr({
          cloneUrl: repo.cloneUrl,
          branch: ws.branch,
          driftBranch: git.branchDrift?.actual ?? null,
          artifactBranches: git.artifactBranches,
          baseBranch: ws.defaultBranch,
          credential: input.creds.git,
          refreshToken: input.refreshGitToken,
          log,
        })
      : null;
  const diffAgainstDefault = input.workspace?.diffAgainstDefault?.bind(input.workspace);
  const changesDiff =
    (repo.kind !== 'hosted' || git.preservedCommits.length > 0) && diffAgainstDefault
      ? await boundedChangesDiff(diffAgainstDefault, ws.cwd, ws.defaultBranch, log)
      : null;
  return { prProbe, changesDiff };
}

export async function deliverStepOutcome(input: StepDeliveryInput): Promise<void> {
  const { client, journal, logger, stepId, stopped, ws, repo, git } = input;
  let lastError = input.lastError;
  let report: string | null = null;
  if (input.infoReportFile !== null && !stopped && lastError === null) {
    const read = readInfoReport(input.infoReportFile);
    if (read.kind === 'too-large') lastError = read.error;
    else if (read.kind === 'report') report = read.content;
  }

  const status = stopped ? 'stopped' : lastError === null ? 'success' : 'failed';
  if (!stopped && lastError !== null) logger.step(`step failed: ${lastError}`);
  journal.update(stepId, { state: 'awaiting-upload' });

  const changes =
    ws !== null &&
    ws.readonly !== true &&
    repo !== null &&
    (lastError === null || git.preservedCommits.length > 0) &&
    !stopped &&
    !input.isReview &&
    !input.attachmentVerify
      ? await probeStepChanges(input, ws, repo)
      : { prProbe: null, changesDiff: null };

  const messages = input.transcript.messages();
  const planContent =
    input.claimed.step.kind === 'plan' && !stopped
      ? readDeliveredPlan(input.plansDir, input.convId, input.cwd)
      : null;
  const doneBody = composeDoneBody(
    {
      status,
      lastError,
      sessionId: input.session.sessionId,
      usage: input.usage,
      hasChanges: git.hasChanges,
      headCommit: git.headCommit,
      preservedCommits: git.preservedCommits,
      pushHookOutput: git.pushHookOutput,
      prProbe: changes.prProbe,
      changesDiff: changes.changesDiff,
      branchDrift: git.branchDrift,
      quotaBlock: input.quotaBlock,
      skillInjectionFacts: input.skillInjectionFacts,
      report,
    },
    {
      kind: input.claimed.step.kind,
      messages,
      attachmentVerify: input.attachmentVerify,
      uploadedEvidence: input.uploadedEvidence,
      cwd: input.cwd,
    },
  );
  const redactedSessionFile = join(input.outboxDir, `step-${stepId}.session.jsonl`);
  const sessionFileForUpload = input.credentialValues.reduce<string | undefined>(
    (source, credential) =>
      prepareCredentialSessionUpload(source, credential, redactedSessionFile, (message) =>
        logger.step(message),
      ),
    input.session.sessionFile,
  );
  journal.update(stepId, {
    state: 'awaiting-upload',
    doneBody,
    planContent,
    sessionFile: sessionFileForUpload ?? null,
  });
  try {
    await putFinalArtifacts(client, logger, stepId, messages, planContent, sessionFileForUpload);
  } catch (err) {
    logger.step(`transcript upload failed: ${err instanceof Error ? err.message : String(err)}`);
    clearCredentials(input.creds);
    return;
  }

  try {
    await client.done(stepId, doneBody);
  } catch (err) {
    logger.step(`done report failed: ${err instanceof Error ? err.message : String(err)}`);
    clearCredentials(input.creds);
    return;
  }
  clearCredentials(input.creds);
  journal.remove(stepId);
  logger.raw(`finished (${input.running - 1} running)`);
}
