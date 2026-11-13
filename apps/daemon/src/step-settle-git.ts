import type {
  BoundGitCredentials,
  ClaimedStep,
  CommitIdentity,
  GitIdentity,
  PreparedWorkspace,
  WorktreeOps,
} from '@cairn/shared';
import { isBuildStepKind, stripAnsiEscapes } from '@cairn/shared';
import { GitPushHookError, isGitAuthFailure } from './git.js';
import { commitAndPushStep, preserveFailedBuild } from './step-closing-git.js';
import type { StepGitRunner } from './step-git-tools.js';

export interface SettleStepGitInput {
  git: WorktreeOps | undefined;
  ws: PreparedWorkspace | null;
  claimed: ClaimedStep;
  stepId: string;
  coAuthor: GitIdentity | null;
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
}

export async function settleStepGit(input: SettleStepGitInput): Promise<SettledStepGit> {
  const { git, ws, claimed } = input;
  const pushStep = (gitOps: WorktreeOps, workspace: PreparedWorkspace) =>
    input.runGit(async (credential) => {
      await gitOps.push(workspace.cwd, workspace.branch, credential, {
        base: input.headAtStart,
        identity: input.appIdentity,
        coAuthor: input.coAuthor,
      });
    });
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
  if (ws !== null && ws.readonly !== true && git && input.closes) {
    const closing = await commitAndPushStep({
      git,
      ws,
      claimed,
      stepId: input.stepId,
      coAuthor: input.coAuthor,
      identity: input.identity,
      mergeCredential: input.mergeCredential,
      headAtStart: input.headAtStart,
      stepStartMs: input.stepStartMs,
      push: () => pushStep(git, ws),
      note: input.note,
      log: input.log,
      logRaw: input.logRaw,
    });
    settled.headCommit = closing.headCommit;
    settled.branchDrift = closing.branchDrift;
    settled.artifactBranches = closing.artifactBranches;
    if (closing.hasChanges !== null) settled.hasChanges = closing.hasChanges;
    if (closing.error !== null) {
      const err = closing.error;
      if (err instanceof GitPushHookError) closingPushHookError = err;
      settled.lastError = err instanceof Error ? err.message : String(err);
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
    !isGitAuthFailure(settled.lastError) &&
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
  return settled;
}
