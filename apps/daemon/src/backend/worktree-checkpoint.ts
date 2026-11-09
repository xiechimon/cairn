import type { WorktreeCheckpoint } from '@cairn/shared';
import { gitPrim, runGit, runGitOk } from '../git.js';

const CHECKPOINT_TIMEOUT_MS = 30_000;

const COMMIT_CREATION_ACTIONS =
  '^(commit|cherry-pick|am)(:|[ (])|^rebase \\((pick|squash|reword|continue)\\):|^(merge|pull) .*: Merge made by';

async function refsOf(cwd: string): Promise<Record<string, string>> {
  const refs = await runGitOk(
    [
      'for-each-ref',
      '--format=%(refname) %(objecttype) %(objectname) %(*objecttype) %(*objectname)',
    ],
    { cwd, timeoutMs: CHECKPOINT_TIMEOUT_MS },
  );
  return Object.fromEntries(
    refs.split('\n').flatMap((line) => {
      const [ref, type, oid, peeledType, peeled] = line.split(' ');
      const commit = type === 'commit' ? oid : peeledType === 'commit' ? peeled : undefined;
      return ref !== undefined && commit !== undefined ? [[ref, commit]] : [];
    }),
  );
}

async function headReflog(cwd: string): Promise<string[]> {
  const refs = await runGitOk(['reflog', 'show', '--format=%H', 'HEAD'], {
    cwd,
    timeoutMs: CHECKPOINT_TIMEOUT_MS,
  });
  return refs.split('\n').filter(Boolean);
}

export async function captureWorktreeCheckpoint(cwd: string): Promise<WorktreeCheckpoint> {
  const commit = await gitPrim.head(cwd);
  if (commit === null) throw new Error('Worktree checkpoint has no HEAD commit');
  const symbolicHead = await runGit(['symbolic-ref', '--quiet', 'HEAD'], {
    cwd,
    timeoutMs: CHECKPOINT_TIMEOUT_MS,
  });
  if (symbolicHead.code !== 0 && symbolicHead.code !== 1)
    throw new Error('Worktree checkpoint could not read the starting branch');
  const ref = symbolicHead.stdout.trim();
  if (symbolicHead.code === 0 && !ref.startsWith('refs/heads/'))
    throw new Error('Worktree checkpoint HEAD is not a local branch');
  const branch = symbolicHead.code === 1 ? null : ref.slice('refs/heads/'.length);
  const refs = await refsOf(cwd);
  const reflog = await headReflog(cwd);
  if (!reflog.includes(commit)) throw new Error('Worktree checkpoint has no HEAD reflog');
  return { commit, branch, refs, headReflog: reflog };
}

export async function restoreWorktreeCheckpoint(
  cwd: string,
  commit: string,
  checkpoint?: WorktreeCheckpoint,
): Promise<void> {
  let changedBranches: [string, string][] = [];
  if (checkpoint !== undefined) {
    if (commit !== checkpoint.commit) throw new Error('Worktree checkpoint commit mismatch');
    const observed = (
      await runGitOk(
        [
          'reflog',
          'show',
          '--format=%H',
          '--extended-regexp',
          `--grep-reflog=${COMMIT_CREATION_ACTIONS}`,
          'HEAD',
        ],
        { cwd, timeoutMs: CHECKPOINT_TIMEOUT_MS },
      )
    )
      .split('\n')
      .filter(Boolean);
    const prior = new Set(checkpoint.headReflog);
    const candidates = [...new Set(observed.filter((oid) => !prior.has(oid)))];
    const created = new Set(
      candidates.length === 0
        ? []
        : (
            await runGitOk(
              [
                'rev-list',
                ...candidates,
                '--not',
                commit,
                ...Object.values(checkpoint.refs),
                ...checkpoint.headReflog,
              ],
              { cwd, timeoutMs: CHECKPOINT_TIMEOUT_MS },
            )
          )
            .split('\n')
            .filter(Boolean),
    );
    const currentRefs = await refsOf(cwd);
    changedBranches = Object.entries(currentRefs).filter(
      ([ref, oid]) =>
        ref.startsWith('refs/heads/') &&
        created.has(oid) &&
        (checkpoint.branch === null || ref !== `refs/heads/${checkpoint.branch}`),
    );
    if (checkpoint.branch === null) {
      await runGitOk(['checkout', '--force', '--detach', commit, '--'], {
        cwd,
        timeoutMs: CHECKPOINT_TIMEOUT_MS,
      });
    } else {
      await runGitOk(
        currentRefs[`refs/heads/${checkpoint.branch}`] === undefined
          ? ['checkout', '--force', '-b', checkpoint.branch, commit, '--']
          : ['checkout', '--force', checkpoint.branch, '--'],
        { cwd, timeoutMs: CHECKPOINT_TIMEOUT_MS },
      );
    }
  }
  await gitPrim.resetHard(cwd, commit);
  await gitPrim.cleanFd(cwd);
  if (checkpoint === undefined || changedBranches.length === 0) return;
  const worktrees = await runGitOk(['worktree', 'list', '--porcelain'], {
    cwd,
    timeoutMs: CHECKPOINT_TIMEOUT_MS,
  });
  const checkedOut = new Set(
    worktrees
      .split('\n')
      .filter((line) => line.startsWith('branch '))
      .map((line) => line.slice(7)),
  );
  for (const [ref, oid] of changedBranches) {
    if (checkedOut.has(ref))
      throw new Error(`Verification changed a branch used by another worktree: ${ref}`);
    const original = checkpoint.refs[ref];
    await runGitOk(
      original === undefined ? ['update-ref', '-d', ref, oid] : ['update-ref', ref, original, oid],
      { cwd, timeoutMs: CHECKPOINT_TIMEOUT_MS },
    );
  }
}
