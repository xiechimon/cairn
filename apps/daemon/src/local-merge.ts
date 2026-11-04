import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { LocalMergeCommand, LocalMergeResult } from '@cairn/shared';
import { type CompareFile, PATCH_DIGEST_VERSION } from '@cairn/shared/merge-gate';
import { commitEnv, gitPrim, landGitSquash, runGit, runGitOk } from './git.js';
import { decideLocalMerge } from './merge-decision.js';

const exec = promisify(execFile);

export async function inspectLocalPatch(
  dir: string,
  base: string,
  head: string,
): Promise<{ files: CompareFile[]; patchDigest: string }> {
  const args = [
    '--literal-pathspecs',
    '-c',
    'core.quotePath=false',
    'diff',
    '--no-ext-diff',
    '--no-textconv',
  ];
  const nameResult = await runGit(
    [...args, '--name-status', '-z', '--find-renames', `${base}...${head}`, '--'],
    { cwd: dir },
  );
  if (nameResult.code !== 0) throw new Error(nameResult.stderr);
  const parts = nameResult.stdout.split('\0');
  const files: CompareFile[] = [];
  for (let i = 0; i < parts.length && parts[i] !== ''; ) {
    const status = parts[i++] ?? '';
    const first = parts[i++];
    const renamed = status.startsWith('R');
    const filename = renamed ? parts[i++] : first;
    if (!filename || !first) throw new Error('Unreadable local diff');
    const paths = renamed ? [first, filename] : [filename];
    const stat = await runGitOk([...args, '--numstat', `${base}...${head}`, '--', ...paths], {
      cwd: dir,
    });
    const [added, removed] = stat.split('\t');
    const diffResult = await runGit([...args, '--unified=3', `${base}...${head}`, '--', ...paths], {
      cwd: dir,
    });
    if (diffResult.code !== 0) throw new Error(diffResult.stderr);
    const diff = diffResult.stdout.replace(/\n$/, '');
    const hunk = diff.indexOf('\n@@');
    const patch = hunk === -1 ? null : diff.slice(hunk + 1);
    const sha = await runGitOk(
      ['rev-parse', '--verify', `${status === 'D' ? base : head}:${filename}`],
      { cwd: dir },
    );
    files.push({
      status: renamed
        ? 'renamed'
        : status === 'A'
          ? 'added'
          : status === 'D'
            ? 'removed'
            : 'modified',
      filename,
      previousFilename: renamed ? first : null,
      sha,
      additions: added === '-' ? 0 : Number(added),
      deletions: removed === '-' ? 0 : Number(removed),
      patchSha: patch === null ? null : createHash('sha256').update(patch).digest('hex'),
    });
  }
  const tuples = files
    .filter(
      (f) =>
        !(
          f.filename.startsWith('docs/verify/') &&
          (f.previousFilename === null || f.previousFilename.startsWith('docs/verify/'))
        ),
    )
    .map((f) => JSON.stringify([f.status, f.filename, f.previousFilename, f.sha, f.patchSha]))
    .sort();
  if (tuples.length === 0) throw new Error('Local patch has no bindable files');
  return {
    files,
    patchDigest: `${PATCH_DIGEST_VERSION}:${createHash('sha256').update(tuples.join('\n')).digest('hex')}`,
  };
}

export async function landLocalMerge(
  dir: string,
  command: LocalMergeCommand,
  shouldStop: () => boolean = () => false,
): Promise<LocalMergeResult> {
  for (const sha of [command.judgedBase, command.judgedHead]) {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Invalid judged commit');
  }
  await runGitOk(['check-ref-format', `refs/heads/${command.defaultBranch}`], { cwd: dir });
  const ref = `refs/heads/${command.defaultBranch}`;
  const receipt = `refs/cairn/local-merges/${command.buildId}`;
  await runGitOk(['check-ref-format', receipt], { cwd: dir });
  await runGitOk(['check-ref-format', `refs/heads/${command.workBranch}`], { cwd: dir });
  const patch = await inspectLocalPatch(dir, command.judgedBase, command.judgedHead);
  if (patch.patchDigest !== command.judgedPatchDigest)
    return { outcome: 'recheck', reason: 'patch-stale' };
  const tree = await runGitOk(['rev-parse', `${command.judgedHead}^{tree}`], { cwd: dir });
  const current = await runGitOk(['rev-parse', ref], { cwd: dir });
  const prior = await runGit(['rev-parse', '--verify', receipt], { cwd: dir });
  const landed = prior.code === 0 ? prior.stdout.trim() : current;
  if (landed !== command.judgedBase) {
    const details = await runGitOk(['show', '-s', '--format=%T%n%P%n%B', landed], { cwd: dir });
    if (details === `${tree}\n${command.judgedBase}\n${command.message.trim()}`) {
      return { outcome: 'merged', commit: landed };
    }
  }
  const facts = async () => ({
    defaultBranch: command.defaultBranch,
    currentBranch: await gitPrim.currentBranch(dir),
    worktreeClean:
      (await runGitOk(['status', '--porcelain', '--untracked-files=all'], {
        cwd: dir,
        env: { GIT_OPTIONAL_LOCKS: '0' },
      })) === '',
    defaultHead: await runGitOk(['rev-parse', '--verify', ref], { cwd: dir }),
    judgedBase: command.judgedBase,
    patchDigest:
      (await runGitOk(['rev-parse', '--verify', `refs/heads/${command.workBranch}`], {
        cwd: dir,
      })) === command.judgedHead
        ? (await inspectLocalPatch(dir, command.judgedBase, command.judgedHead)).patchDigest
        : 'stale',
    judgedPatchDigest: command.judgedPatchDigest,
  });
  const initial = decideLocalMerge(await facts());
  if (initial.action === 'hold') return { outcome: 'held', reason: initial.reason };
  if (initial.action === 'recheck') return { outcome: 'recheck', reason: initial.reason };
  if (
    (await runGitOk(['merge-base', command.judgedBase, command.judgedHead], { cwd: dir })) !==
    command.judgedBase
  ) {
    return { outcome: 'recheck', reason: 'default-head-moved' };
  }
  if (command.localChecks.length === 0)
    return { outcome: 'checks-failed', reason: 'No required local checks configured' };
  const temp = mkdtempSync(join(tmpdir(), 'cairn-local-merge-'));
  const candidate = join(temp, 'candidate');
  let added = false;
  try {
    await runGitOk(['worktree', 'add', '--detach', candidate, command.judgedHead], { cwd: dir });
    added = true;
    const date = await runGitOk(['show', '-s', '--format=%cI', command.judgedHead], { cwd: dir });
    const commit = await runGitOk(
      ['commit-tree', tree, '-p', command.judgedBase, '-m', command.message],
      {
        cwd: dir,
        env: { ...commitEnv(command.identity), GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      },
    );
    await runGitOk(['checkout', '--detach', commit], { cwd: candidate });
    for (const check of command.localChecks) {
      try {
        await exec('/bin/sh', ['-c', check], {
          cwd: candidate,
          timeout: 300_000,
          maxBuffer: 1024 * 1024,
        });
      } catch {
        return { outcome: 'checks-failed', reason: check };
      }
    }
    if (shouldStop()) return { outcome: 'held', reason: 'stopped' };
    const decision = decideLocalMerge(await facts());
    if (decision.action === 'hold') return { outcome: 'held', reason: decision.reason };
    if (decision.action === 'recheck') return { outcome: 'recheck', reason: decision.reason };
    const worktrees = await runGitOk(['worktree', 'list', '--porcelain'], { cwd: dir });
    const checkedOut = worktrees.split('\n\n').filter((entry) => entry.includes(`\nbranch ${ref}`));
    if (checkedOut.length > (decision.action === 'fast-forward' ? 1 : 0))
      return { outcome: 'held', reason: 'checkout-unknown' };
    const landed = await landGitSquash({
      dir,
      branch: command.defaultBranch,
      currentBranch:
        decision.action === 'fast-forward'
          ? command.defaultBranch
          : ((await gitPrim.currentBranch(dir)) ?? ''),
      base: command.judgedBase,
      commit,
      receipt,
    });
    if (landed === 'dirty') return { outcome: 'held', reason: 'worktree-dirty' };
    if (landed !== 'landed') return { outcome: 'recheck', reason: 'default-head-moved' };
    return { outcome: 'merged', commit };
  } finally {
    if (added) await gitPrim.worktreeRemoveForce(dir, candidate);
    rmSync(temp, { recursive: true, force: true });
  }
}
