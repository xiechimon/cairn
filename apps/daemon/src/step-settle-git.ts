import type {
  BoundGitCredentials,
  ClaimedStep,
  CommitIdentity,
  PreparedWorkspace,
  WorktreeOps,
} from '@cairn/shared';
import { isBuildStepKind, stripAnsiEscapes, WORKFLOW_PUSH_REFUSAL } from '@cairn/shared';
import {
  GitPushHookError,
  isGitAuthFailure,
  isGitPermanentFailure,
  isGitWorkflowPermissionRejection,
} from './git.js';
import { GitHubAppTokenUnavailableError } from './step-app-credential.js';
import { commitAndPushStep, preserveFailedBuild } from './step-closing-git.js';
import type { StepGitRunner } from './step-git-tools.js';

export interface SettleStepGitInput {
  git: WorktreeOps | undefined;
  ws: PreparedWorkspace | null;
  claimed: ClaimedStep;
  stepId: string;
  appIdentity: CommitIdentity | null;
  identity: CommitIdentity;
  mergeCredential: BoundGitCredentials | null;
  headAtStart: string | null;
  stepStartMs: number;
  runGit: StepGitRunner;
  headCommit: string | null;
  hasChanges: boolean;
  lastError: string | null;
  stopped: boolean;
  closes: boolean;
  env?: NodeJS.ProcessEnv;
  note: (id: string, content: string) => void;
  log: (message: string) => void;
  logRaw: (message: string) => void;
}

export interface SettledStepGit {
  headCommit: string | null;
  branchDrift: { expected: string; actual: string } | null;
  artifactBranches: string[];
  hasChanges: boolean;
  pushHookOutput: string | null;
  preservedCommits: string[];
  lastError: string | null;
  unpushedCommits?: number | null;
}

export async function settleStepGit(input: SettleStepGitInput): Promise<SettledStepGit> {
  const { git, ws, claimed } = input;
  let workflowPushRefused = false;
  const pushStep = async (gitOps: WorktreeOps, workspace: PreparedWorkspace) => {
    try {
      return await input.runGit((credential) =>
        gitOps.push(workspace.cwd, workspace.branch, credential, {
          base: input.headAtStart,
          identity: input.appIdentity,
          stepId: input.stepId,
        }),
      );
    } catch (error) {
      workflowPushRefused =
        !(error instanceof GitPushHookError) &&
        isGitWorkflowPermissionRejection(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  const settled: SettledStepGit = {
    headCommit: input.headCommit,
    branchDrift: null,
    artifactBranches: [],
    hasChanges: input.hasChanges,
    pushHookOutput: null,
    preservedCommits: [],
    lastError: input.lastError,
  };
  let closingPushHookError: GitPushHookError | null = null;
  let closingPushCannotRetry = false;
  if (ws !== null && ws.readonly !== true && git && input.closes) {
    const closing = await commitAndPushStep({
      git,
      ws,
      claimed,
      stepId: input.stepId,
      identity: input.identity,
      mergeCredential: input.mergeCredential,
      headAtStart: input.headAtStart,
      stepStartMs: input.stepStartMs,
      push: () => pushStep(git, ws),
      env: input.env,
      note: input.note,
      log: input.log,
      logRaw: input.logRaw,
    });
    settled.headCommit = closing.headCommit;
    settled.branchDrift = closing.branchDrift;
    settled.artifactBranches = closing.artifactBranches;
    if (closing.unpushedCommits !== undefined) settled.unpushedCommits = closing.unpushedCommits;
    if (closing.hasChanges !== null) settled.hasChanges = closing.hasChanges;
    if (closing.error !== null) {
      const { cause, duringPush } = closing.error;
      const message = cause instanceof Error ? cause.message : String(cause);
      settled.lastError = message;
      if (duringPush) {
        if (cause instanceof GitPushHookError) closingPushHookError = cause;
        closingPushCannotRetry =
          cause instanceof GitHubAppTokenUnavailableError ||
          isGitAuthFailure(message) ||
          isGitPermanentFailure(message);
      }
    }
  }

  if (isBuildStepKind(claimed.step.kind) && closingPushHookError !== null) {
    settled.pushHookOutput = stripAnsiEscapes(closingPushHookError.message);
    settled.lastError = null;
    if (ws !== null && git) {
      settled.headCommit = await git.headCommit(ws.cwd);
      settled.hasChanges = true;
    }
  }

  if (
    isBuildStepKind(claimed.step.kind) &&
    settled.lastError !== null &&
    !closingPushCannotRetry &&
    !input.stopped &&
    ws !== null &&
    ws.readonly !== true &&
    git
  ) {
    const preserved = await preserveFailedBuild({
      git,
      ws,
      claimed,
      push: () => pushStep(git, ws),
      log: input.log,
      logRaw: input.logRaw,
    });
    if (preserved !== null) {
      settled.headCommit = preserved.headCommit;
      settled.preservedCommits = preserved.commits;
      settled.hasChanges = true;
    }
  }
  if (workflowPushRefused) settled.lastError = WORKFLOW_PUSH_REFUSAL;
  return settled;
}
