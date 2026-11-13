import { rmSync } from 'node:fs';
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
