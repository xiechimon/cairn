import { readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import * as gitModule from '../src/git.js';
import { commitEnv, runGitOk } from '../src/git.js';
import { inspectLocalPatch, landLocalMerge } from '../src/local-merge.js';

const identity = { name: 'local-merge-test', email: 'merge@cairn.local' };
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) releaseTestTempDir(root);
});

async function fixture() {
  const dir = makeTestTempDir('local-merge-');
  roots.push(dir);
  const git = (args: string[]) => runGitOk(args, { cwd: dir, env: commitEnv(identity) });
  await git(['init', '-b', 'main']);
  writeFileSync(join(dir, 'file.txt'), 'base\n');
  await git(['add', 'file.txt']);
  await git(['commit', '-m', 'base']);
  await git(['commit', '--allow-empty', '-m', 'judged base']);
  const base = await git(['rev-parse', 'HEAD']);
  await git(['checkout', '-b', 'work']);
  writeFileSync(join(dir, 'file.txt'), 'candidate\n');
  await git(['commit', '-am', 'first']);
  writeFileSync(join(dir, 'added.txt'), 'added\n');
  await git(['add', 'added.txt']);
  await git(['commit', '-m', 'second']);
  const head = await git(['rev-parse', 'HEAD']);
  await git(['checkout', 'main']);
  const patch = await inspectLocalPatch(dir, base, head);
  const command = {
    projectId: 'project',
    buildId: 'build',
    defaultBranch: 'main',
    workBranch: 'work',
    judgedBase: base,
    judgedHead: head,
    judgedPatchDigest: patch.patchDigest,
    localChecks: ['test "$(cat file.txt)" = candidate'],
    message: 'Deliver candidate\n\nCloses #12',
    identity,
  };
  return { dir, git, base, head, command };
}

test('clean default checkout advances by exactly one squash commit', async () => {
  const f = await fixture();
  const result = await landLocalMerge(f.dir, f.command);
  expect(result.outcome).toBe('merged');
  expect(await f.git(['rev-list', '--count', `${f.base}..main`])).toBe('1');
  expect(await f.git(['rev-parse', 'main^'])).toBe(f.base);
  expect(await f.git(['rev-parse', 'main^{tree}'])).toBe(
    await f.git(['rev-parse', `${f.head}^{tree}`]),
  );
  expect(readFileSync(join(f.dir, 'file.txt'), 'utf8')).toBe('candidate\n');
  expect(await f.git(['status', '--porcelain'])).toBe('');
  expect(await f.git(['log', '-1', '--format=%B'])).toBe(f.command.message);
  expect(await landLocalMerge(f.dir, f.command)).toEqual(result);
});

test('another clean branch keeps its branch, index and files unchanged', async () => {
  const f = await fixture();
  await f.git(['checkout', '-b', 'user']);
  utimesSync(join(f.dir, 'file.txt'), new Date(0), new Date(0));
  const index = readFileSync(join(f.dir, '.git', 'index'));
  expect((await landLocalMerge(f.dir, f.command)).outcome).toBe('merged');
  expect(await f.git(['branch', '--show-current'])).toBe('user');
  expect(await f.git(['rev-parse', 'HEAD'])).toBe(f.base);
  expect(readFileSync(join(f.dir, '.git', 'index'))).toEqual(index);
  expect(readFileSync(join(f.dir, 'file.txt'), 'utf8')).toBe('base\n');
});

for (const branch of ['main', 'user']) {
  test(`dirty ${branch} checkout holds without changing files or index`, async () => {
    const f = await fixture();
    if (branch !== 'main') await f.git(['checkout', '-b', branch]);
    writeFileSync(join(f.dir, 'file.txt'), 'user edits\n');
    const index = readFileSync(join(f.dir, '.git', 'index'));
    expect(await landLocalMerge(f.dir, f.command)).toEqual({
      outcome: 'held',
      reason: 'worktree-dirty',
    });
    expect(await f.git(['rev-parse', 'main'])).toBe(f.base);
    expect(readFileSync(join(f.dir, 'file.txt'), 'utf8')).toBe('user edits\n');
    expect(readFileSync(join(f.dir, '.git', 'index'))).toEqual(index);
  });
}

test('detached checkout holds', async () => {
  const f = await fixture();
  await f.git(['checkout', '--detach']);
  expect(await landLocalMerge(f.dir, f.command)).toEqual({
    outcome: 'held',
    reason: 'checkout-unknown',
  });
});

test('a moved default ref requires a new judgment', async () => {
  const f = await fixture();
  await f.git(['commit', '--allow-empty', '-m', 'user commit']);
  const before = await f.git(['rev-parse', 'HEAD']);
  expect(await landLocalMerge(f.dir, f.command)).toEqual({
    outcome: 'recheck',
    reason: 'default-head-moved',
  });
  expect(await f.git(['rev-parse', 'HEAD'])).toBe(before);
});

test('a stale patch requires a new judgment', async () => {
  const f = await fixture();
  expect(await landLocalMerge(f.dir, { ...f.command, judgedPatchDigest: 'pd2:stale' })).toEqual({
    outcome: 'recheck',
    reason: 'patch-stale',
  });
  expect(await f.git(['rev-parse', 'main'])).toBe(f.base);
});

test('failed checks name the command and leave the default ref unchanged', async () => {
  const f = await fixture();
  expect(await landLocalMerge(f.dir, { ...f.command, localChecks: ['exit 7'] })).toEqual({
    outcome: 'checks-failed',
    reason: 'exit 7',
  });
  expect(await f.git(['rev-parse', 'main'])).toBe(f.base);
  expect((await f.git(['worktree', 'list', '--porcelain'])).match(/worktree /g)).toHaveLength(1);
});

test('a check moving the default ref cannot overwrite the concurrent commit', async () => {
  const f = await fixture();
  await f.git(['checkout', '-b', 'user']);
  const result = await landLocalMerge(f.dir, {
    ...f.command,
    localChecks: [`git update-ref refs/heads/main ${f.head} ${f.base}`],
  });
  expect(result).toEqual({ outcome: 'recheck', reason: 'default-head-moved' });
  expect(await f.git(['rev-parse', 'main'])).toBe(f.head);
});

test('a changed work branch cannot land an earlier judged patch', async () => {
  const f = await fixture();
  await f.git(['update-ref', 'refs/heads/work', f.base, f.head]);
  expect(await landLocalMerge(f.dir, f.command)).toEqual({
    outcome: 'recheck',
    reason: 'patch-stale',
  });
  expect(await f.git(['rev-parse', 'main'])).toBe(f.base);
});

test('interrupted result recording is recovered without a second squash commit', async () => {
  const f = await fixture();
  const result = await landLocalMerge(f.dir, f.command);
  await f.git(['update-ref', '-d', 'refs/cairn/local-merges/build']);
  expect(await landLocalMerge(f.dir, f.command)).toEqual(result);
  expect(await f.git(['rev-list', '--count', `${f.base}..main`])).toBe('1');
});

test('a default ref rewind between the last read and landing fails the compare-and-swap', async () => {
  const f = await fixture();
  const previous = await f.git(['rev-parse', `${f.base}^`]);
  const original = gitModule.landGitSquash;
  vi.spyOn(gitModule, 'landGitSquash').mockImplementation(async (input) => {
    await f.git(['update-ref', 'refs/heads/main', previous, f.base]);
    return original(input);
  });
  expect(await landLocalMerge(f.dir, f.command)).toEqual({
    outcome: 'recheck',
    reason: 'default-head-moved',
  });
  expect(await f.git(['rev-parse', 'main'])).toBe(previous);
});

test('an alternate checkout dirtied while acquiring the ref transaction is held', async () => {
  const f = await fixture();
  await f.git(['checkout', '-b', 'user']);
  const original = gitModule.landGitSquash;
  vi.spyOn(gitModule, 'landGitSquash').mockImplementation(async (input) => {
    writeFileSync(join(f.dir, 'file.txt'), 'concurrent user work\n');
    return original(input);
  });
  expect(await landLocalMerge(f.dir, f.command)).toEqual({
    outcome: 'held',
    reason: 'worktree-dirty',
  });
  expect(await f.git(['rev-parse', 'main'])).toBe(f.base);
  expect(readFileSync(join(f.dir, 'file.txt'), 'utf8')).toBe('concurrent user work\n');
});
