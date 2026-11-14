import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BoundGitCredentials,
  ClaimedStep,
  PreparedWorkspace,
  WorktreeOps,
} from '@cairn/shared';
import { LocalRepoUnreachableError } from '@cairn/shared';
import { createVerificationClone } from './backend/verification-clone.js';
import { type GitCredentialFallbackOpts, withGitCredentialFallback } from './git.js';
import { localRepoUnreachableMessage } from './workspace.js';

export type StepRepo = NonNullable<NonNullable<ClaimedStep['project']>['repo']>;

export interface StepWorkspaceInput {
  workspace: WorktreeOps;
  claimed: ClaimedStep;
  repo: StepRepo;
  workspacesRoot: string;
  credentials: BoundGitCredentials | null;
  readonly: boolean;
  refresh: GitCredentialFallbackOpts['refresh'];
  machineName: string;
}

export type StepWorkspaceResult = { ws: PreparedWorkspace | null } | { error: string };

export async function prepareStepWorkspace(
  input: StepWorkspaceInput,
): Promise<StepWorkspaceResult> {
  const { workspace, claimed, repo } = input;
  try {
    const prepare = () =>
      workspace.prepare({
        projectId: claimed.project?.id ?? '',
        conversationId: claimed.conversationId,
        cloneUrl: repo.cloneUrl,
        repoKind: repo.kind,
        baseBranch: repo.baseBranch,
        workspacesRoot: input.workspacesRoot,
        credentials: input.credentials,
        localPath: repo.kind === 'github' ? (repo.localPath ?? null) : null,
        machineCredentialFallback: repo.kind === 'github',
        ...(input.readonly ? { readonly: true } : {}),
      });
    const prepared: { workspace: PreparedWorkspace | null } = { workspace: null };
    await withGitCredentialFallback(
      async () => {
        prepared.workspace = await prepare();
      },
      input.credentials,
      {
        what: 'prepare',
        allowMachineFallback: false,
        refresh: input.refresh,
      },
    );
    return { ws: prepared.workspace };
  } catch (err) {
    return {
      error:
        err instanceof LocalRepoUnreachableError
          ? localRepoUnreachableMessage(input.machineName, err)
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}

export interface VerifyCloneInput {
  workspace: WorktreeOps | undefined;
  ws: PreparedWorkspace | null;
  headAtStart: string | null;
  evidenceDirectory: string | undefined;
  expectedHeadSha: string | undefined;
  cleanups: (() => void | Promise<void>)[];
}

export type VerifyCloneResult =
  | { ws: PreparedWorkspace; cwd: string; headAtStart: string | null }
  | { error: string };

export async function prepareVerifyClone(input: VerifyCloneInput): Promise<VerifyCloneResult> {
  const { workspace, ws, headAtStart } = input;
  if (
    input.evidenceDirectory === undefined ||
    !/^\.cairn-verify\/[a-zA-Z0-9_-]+\/$/.test(input.evidenceDirectory)
  ) {
    return { error: 'Verify evidence directory unavailable or invalid' };
  }
  if (ws === null || ws.readonly === true || !workspace || headAtStart === null) {
    return { error: 'Verify delivery commit unavailable' };
  }
  try {
    const clone = await createVerificationClone(ws.cwd, input.expectedHeadSha ?? headAtStart);
    input.cleanups.push(clone.cleanup);
    return {
      ws: { ...ws, cwd: clone.cwd, reused: false },
      cwd: clone.cwd,
      headAtStart: await workspace.headCommit(clone.cwd),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export interface StepWorkspaceSetupInput {
  workspace: WorktreeOps | undefined;
  claimed: ClaimedStep;
  repo: StepRepo | null;
  workspacesRoot: string;
  credentials: BoundGitCredentials | null;
  readonly: boolean;
  refresh: GitCredentialFallbackOpts['refresh'];
  machineName: string;
  attachmentVerify: boolean;
  evidenceDirectory: string | undefined;
  expectedHeadSha: string | undefined;
  cleanups: (() => void | Promise<void>)[];
}

export type StepWorkspaceSetup =
  | {
      ws: PreparedWorkspace | null;
      cwd: string;
      headAtStart: string | null;
      stepStartMs: number;
    }
  | { error: string };

export async function setUpStepWorkspace(
  input: StepWorkspaceSetupInput,
): Promise<StepWorkspaceSetup> {
  const { workspace, repo } = input;
  let ws: PreparedWorkspace | null = null;
  if (repo !== null) {
    if (!workspace) return { error: 'workspace ops unavailable for repo-bound step' };
    const prepared = await prepareStepWorkspace({
      workspace,
      claimed: input.claimed,
      repo,
      workspacesRoot: input.workspacesRoot,
      credentials: input.credentials,
      readonly: input.readonly,
      refresh: input.refresh,
      machineName: input.machineName,
    });
    if ('error' in prepared) return prepared;
    ws = prepared.ws;
  }
  let cwd = ws?.cwd ?? join(input.workspacesRoot, input.claimed.conversationId);
  if (!ws) mkdirSync(cwd, { recursive: true });

  const stepStartMs = Date.now();
  let headAtStart: string | null = null;
  if (ws !== null && ws.readonly !== true && workspace) {
    try {
      headAtStart = await workspace.headCommit(ws.cwd);
    } catch {
      headAtStart = null;
    }
  }

  if (input.attachmentVerify) {
    const verifyClone = await prepareVerifyClone({
      workspace,
      ws,
      headAtStart,
      evidenceDirectory: input.evidenceDirectory,
      expectedHeadSha: input.expectedHeadSha,
      cleanups: input.cleanups,
    });
    if ('error' in verifyClone) return verifyClone;
    ws = verifyClone.ws;
    cwd = verifyClone.cwd;
    headAtStart = verifyClone.headAtStart;
  }
  return { ws, cwd, headAtStart, stepStartMs };
}

export async function resetFreshSessionWorkspace(input: {
  workspace: Pick<WorktreeOps, 'restoreCheckpoint'>;
  cwd: string;
  headAtStart: string;
  planFile: string;
}): Promise<string | null> {
  try {
    await input.workspace.restoreCheckpoint(input.cwd, input.headAtStart);
    rmSync(input.planFile, { force: true });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
