import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import { planRebuild, queueChain, rebuild } from './rebuild-queue.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);

test('a mid-chain drop keeps every other candidate in order', () => {
  assert.deepEqual(planRebuild({ chain: [A, B, C, D], dropSha: B }), {
    action: 'rebuild',
    keep: [A, C, D],
    dropSha: B,
  });
});

test('dropping the only candidate deletes the ref', () => {
  assert.equal(planRebuild({ chain: [A], dropSha: A }).action, 'delete');
});

test('a sha not on the queue is rejected', () => {
  assert.equal(planRebuild({ chain: [A, B], dropSha: C }).action, 'reject');
});

function makeRepo() {
  const dir = makeTestTempDir('rebuild-queue-test-');
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  };
  const git = (args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
  git(['init', '-q', '-b', 'main']);
  const commit = (name) => {
    writeFileSync(join(dir, `${name}.txt`), name);
    git(['add', `${name}.txt`]);
    git(['commit', '-qm', name]);
    return git(['rev-parse', 'HEAD']);
  };
  return { dir, git, commit, cleanup: () => releaseTestTempDir(dir) };
}

test('rebuild replays the queue without the dropped sha', (t) => {
  const { dir, git, commit, cleanup } = makeRepo();
  t.after(cleanup);
  const main = commit('main');
  const a = commit('a');
  const b = commit('b');
  const c = commit('c');
  git(['update-ref', 'refs/remotes/origin/main', main]);
  git(['update-ref', 'refs/remotes/origin/queue/main', c]);

  const { newHead } = rebuild(dir, { dropSha: b });
  const chain = git(['rev-list', '--reverse', `origin/main..${newHead}`]).split('\n');
  assert.equal(chain.length, 2);
  assert.equal(chain[0], a);
  assert.equal(git(['show', '-s', '--format=%s', chain[1]]), 'c');
  assert.equal(git(['show', '-s', '--format=%s', newHead]), 'c');
});

test('rebuild dropping the head lands on the commit below', (t) => {
  const { dir, git, commit, cleanup } = makeRepo();
  t.after(cleanup);
  const main = commit('main');
  const a = commit('a');
  const b = commit('b');
  git(['update-ref', 'refs/remotes/origin/main', main]);
  git(['update-ref', 'refs/remotes/origin/queue/main', b]);

  const { newHead } = rebuild(dir, { dropSha: b });
  assert.equal(newHead, a);
});

test('queueChain lists the stacked candidates oldest first', (t) => {
  const { dir, git, commit, cleanup } = makeRepo();
  t.after(cleanup);
  const main = commit('main');
  const a = commit('a');
  const b = commit('b');
  git(['update-ref', 'refs/remotes/origin/main', main]);
  git(['update-ref', 'refs/remotes/origin/queue/main', b]);
  assert.deepEqual(queueChain(dir), [a, b]);
});
