import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conversationBranch, localCommitIdentity, RETRY_PARKED_MARK } from '@cairn/shared';
import { commitEnv, runGit, runGitOk } from '../git.js';
import { readOrbFile } from './runtime-fs.js';

export const ORB_MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

export interface OrbLocalDelivery {
  outboxDir: string;
  repoPath: string;
  conversationId: string;
}

const ZERO_OID = '0000000000000000000000000000000000000000';

function parked(message: string): Error {
  return new Error(`${RETRY_PARKED_MARK}: ${message}`);
}

export async function deliverOrbBundle(input: OrbLocalDelivery, filename: string): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-orb-delivery-'));
  try {
    const content = readOrbFile(input.outboxDir, filename, ORB_MAX_BUNDLE_BYTES);
    const bundle = join(directory, 'verified.bundle');
    writeFileSync(bundle, content, { mode: 0o600 });
    const opts = { cwd: input.repoPath, timeoutMs: 120_000 };
    await runGitOk(['bundle', 'verify', bundle], opts);
    const refs = await runGitOk(['bundle', 'list-heads', bundle], opts);
    const branch = conversationBranch(input.conversationId);
    const ref = `refs/heads/${branch}`;
    const lines = refs.split('\n');
    const [oid, name] = (lines[0] ?? '').split(' ');
    if (
      !oid ||
      lines.length !== 1 ||
      name !== ref ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid ?? '')
    )
      throw new Error('Bundle must contain only the claimed Thread branch');
    const temp = `refs/cairn/orb-delivery/${randomUUID()}`;
    await runGitOk(
      [
        'fetch',
        '--no-tags',
        '--no-write-fetch-head',
        '--refmap=',
        '--end-of-options',
        bundle,
        `${ref}:${temp}`,
      ],
      opts,
    );
    try {
      await landDeliveredTip(input.repoPath, ref, branch, oid, directory);
    } finally {
      await runGit(['update-ref', '-d', temp], { cwd: input.repoPath, timeoutMs: 30_000 });
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(RETRY_PARKED_MARK)) throw error;
    throw new Error(
      `Local bundle delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function landDeliveredTip(
  repoPath: string,
  ref: string,
  branch: string,
  oid: string,
  scratchDir: string,
): Promise<void> {
  const opts = { cwd: repoPath, timeoutMs: 120_000 };
  const tip = await runGit(['rev-parse', '--verify', '--end-of-options', ref], opts).then((r) =>
    r.code === 0 ? r.stdout.trim() : null,
  );
  if (tip === null) {
    const created = await runGit(['update-ref', '--end-of-options', ref, oid, ZERO_OID], opts);
    if (created.code !== 0)
      throw new Error(`${ref} appeared while the delivered work was being staged`);
    return;
  }
  const ancestor = async (a: string, b: string) =>
    (await runGit(['merge-base', '--is-ancestor', '--end-of-options', a, b], opts)).code === 0;
  if (await ancestor(oid, ref)) return;
  const worktrees = await runGit(['worktree', 'list', '--porcelain'], opts);
  if (worktrees.code !== 0)
    throw new Error(`git worktree list failed (${worktrees.code}): ${worktrees.stderr.trim()}`);
  const checkedOut = worktrees.stdout
    .split('\n\n')
    .some((entry) => entry.split('\n').includes(`branch ${ref}`));
  if (checkedOut)
    throw parked(
      `the step's delivered work cannot land on ${ref} — the branch is checked out in a worktree and moved since the step started. Switch that worktree off ${branch}, then retry the task.`,
    );
  const cas = async (next: string) => {
    const moved = await runGit(['update-ref', '--end-of-options', ref, next, tip], opts);
    if (moved.code !== 0)
      throw new Error(`${ref} moved while the delivered work was being reconciled`);
  };
  if (await ancestor(tip, oid)) {
    await cas(oid);
    return;
  }
  const base = await runGit(['merge-base', '--end-of-options', tip, oid], opts).then((r) =>
    r.code === 0 ? r.stdout.trim() : null,
  );
  if (base === null)
    throw parked(
      `the step's delivered work and the repository's ${ref} share no history. Reconcile ${branch} by hand, then retry the task.`,
    );
  const mergeDir = join(scratchDir, 'merge-worktree');
  const hooksDir = join(scratchDir, 'empty-hooks');
  mkdirSync(hooksDir, { recursive: true });
  const added = await runGit(
    [
      '-c',
      `core.hooksPath=${hooksDir}`,
      'worktree',
      'add',
      '--detach',
      '--end-of-options',
      mergeDir,
      tip,
    ],
    opts,
  );
  if (added.code !== 0)
    throw new Error(
      `git worktree add failed (${added.code}): ${added.stderr.trim() || added.stdout.trim()}`,
    );
  try {
    const merge = await runGit(
      [
        '-c',
        `core.hooksPath=${hooksDir}`,
        'merge',
        '--no-edit',
        '-m',
        `Merge delivered Thread work into ${branch}`,
        '--end-of-options',
        oid,
      ],
      {
        cwd: mergeDir,
        env: commitEnv(localCommitIdentity('cairn')),
        timeoutMs: 120_000,
      },
    );
    if (merge.code !== 0) {
      await runGit(['merge', '--abort'], { cwd: mergeDir, timeoutMs: 30_000 });
      const detail = (merge.stderr.trim() || merge.stdout.trim()).split('\n').at(-1) || 'conflict';
      throw parked(
        `the step's delivered work conflicts with ${ref} — the branch moved while the step ran and the merge cannot be resolved automatically (${detail}). Reconcile ${branch} in the repository by hand, then retry the task.`,
      );
    }
    const mergedTip = await runGit(['rev-parse', '--verify', '--end-of-options', 'HEAD'], {
      cwd: mergeDir,
      timeoutMs: 30_000,
    }).then((r) => (r.code === 0 ? r.stdout.trim() : null));
    if (mergedTip === null) throw new Error('the merge left no resolvable tip');
    await cas(mergedTip);
  } finally {
    await runGit(['worktree', 'remove', '--force', '--end-of-options', mergeDir], {
      cwd: repoPath,
      timeoutMs: 30_000,
    });
  }
}
