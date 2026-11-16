import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { refusedRefs } from './prepush-main-guard.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const root = join(import.meta.dirname, '..');
const local = 'a'.repeat(40);
const remote = 'b'.repeat(40);
const zero = '0'.repeat(40);
const line = (localRef, localSha, remoteRef, remoteSha) =>
  `${localRef} ${localSha} ${remoteRef} ${remoteSha}\n`;
const always = () => true;
const never = () => false;

test('allows a fast-forward of main and a first push of main', () => {
  assert.deepEqual(refusedRefs(line('HEAD', local, 'refs/heads/main', remote), always), []);
  assert.deepEqual(refusedRefs(line('HEAD', local, 'refs/heads/main', zero), never), []);
});

test('refuses a non-fast-forward update and a deletion of main', () => {
  assert.deepEqual(refusedRefs(line('HEAD', local, 'refs/heads/main', remote), never), [
    'refs/heads/main',
  ]);
  assert.deepEqual(refusedRefs(line('(delete)', zero, 'refs/heads/main', remote), always), [
    'refs/heads/main',
  ]);
});

test('judges only main among several pushed refs', () => {
  const stdin =
    line('refs/heads/a', local, 'refs/heads/a', remote) +
    line('refs/heads/b', local, 'refs/heads/main', remote);
  assert.deepEqual(refusedRefs(stdin, never), ['refs/heads/main']);
  assert.deepEqual(
    refusedRefs(line('refs/heads/main', local, 'refs/heads/main-fix', remote), never),
    [],
  );
  assert.deepEqual(
    refusedRefs(line('refs/heads/main', local, 'refs/tags/main', remote), never),
    [],
  );
  assert.deepEqual(refusedRefs(''), []);
});

test('the script reads ancestry from git and exits non-zero only on a rewrite of main', (t) => {
  const repo = makeTestTempDir('prepush-main-guard-');
  t.after(() => releaseTestTempDir(repo));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  git('commit', '-q', '--allow-empty', '-m', 'next');
  const next = git('rev-parse', 'HEAD');
  git('checkout', '-q', '--detach', base);
  git('commit', '-q', '--allow-empty', '-m', 'other');
  const other = git('rev-parse', 'HEAD');
  const run = (input) =>
    spawnSync(process.execPath, [join(root, 'scripts/prepush-main-guard.mjs')], {
      cwd: repo,
      input,
      encoding: 'utf8',
    });
  assert.equal(run(line('HEAD', next, 'refs/heads/main', base)).status, 0);
  const rewrite = run(line('HEAD', other, 'refs/heads/main', next));
  assert.equal(rewrite.status, 1);
  assert.match(rewrite.stderr, /refs\/heads\/main/);
  assert.equal(run(line('HEAD', other, 'refs/heads/main', remote)).status, 1);
});

test('the real pre-push hook guards main without rerunning verification', (t) => {
  const repo = makeTestTempDir('prepush-hook-');
  t.after(() => releaseTestTempDir(repo));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  git('commit', '-q', '--allow-empty', '-m', 'next');
  const next = git('rev-parse', 'HEAD');
  const hook = readFileSync(join(root, '.husky/pre-push'), 'utf8').replace(
    'node scripts/prepush-main-guard.mjs',
    `${JSON.stringify(process.execPath)} ${JSON.stringify(join(root, 'scripts/prepush-main-guard.mjs'))}`,
  );
  const run = (input) => spawnSync('sh', ['-c', hook], { cwd: repo, input, encoding: 'utf8' });
  assert.equal(run(line('HEAD', next, 'refs/heads/main', base)).status, 0);
  assert.equal(run(line('HEAD', base, 'refs/heads/main', next)).status, 1);
  assert.equal(run(line('(delete)', zero, 'refs/heads/main', next)).status, 1);
});
