import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { syncReviewCheckout } from './reviewer-route.mjs';

function clone(t) {
  const root = mkdtempSync(join(tmpdir(), 'review-checkout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin');
  const lane = join(root, 'lane');
  const run = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', origin]);
  run(origin, ['config', 'user.email', 'test@example.invalid']);
  run(origin, ['config', 'user.name', 'test']);
  writeFileSync(join(origin, 'drizzle.txt'), '0057\n');
  run(origin, ['add', '.']);
  run(origin, ['commit', '-q', '-m', 'old main']);
  const old = run(origin, ['rev-parse', 'HEAD']);
  execFileSync('git', ['clone', '-q', origin, lane]);
  run(lane, ['checkout', '-q', '--detach', old]);
  writeFileSync(join(origin, 'drizzle.txt'), '0084\n');
  run(origin, ['commit', '-q', '-am', 'new main']);
  run(lane, ['fetch', '-q', 'origin', 'main']);
  const git = (args) => execFileSync('git', args, { cwd: lane, encoding: 'utf8' });
  return { lane, old, main: run(lane, ['rev-parse', 'origin/main']), git, run };
}

test('a clean checkout left at an old commit moves to origin/main, so reviewers read current base files', (t) => {
  const c = clone(t);
  syncReviewCheckout(c.git);
  assert.equal(c.run(c.lane, ['rev-parse', 'HEAD']), c.main);
  assert.equal(readFileSync(join(c.lane, 'drizzle.txt'), 'utf8'), '0084\n');
});

test('a modified tracked file refuses the round and leaves the tree and HEAD untouched', (t) => {
  const c = clone(t);
  writeFileSync(join(c.lane, 'drizzle.txt'), 'local edit\n');
  assert.throws(() => syncReviewCheckout(c.git), /local changes.*drizzle\.txt/s);
  assert.equal(c.run(c.lane, ['rev-parse', 'HEAD']), c.old);
  assert.equal(readFileSync(join(c.lane, 'drizzle.txt'), 'utf8'), 'local edit\n');
});

test('a staged change refuses the round', (t) => {
  const c = clone(t);
  writeFileSync(join(c.lane, 'staged.txt'), 'x\n');
  c.run(c.lane, ['add', 'staged.txt']);
  assert.throws(() => syncReviewCheckout(c.git), /local changes/);
  assert.equal(c.run(c.lane, ['rev-parse', 'HEAD']), c.old);
});

test('untracked files alone do not block the move and are kept', (t) => {
  const c = clone(t);
  writeFileSync(join(c.lane, 'scratch.log'), 'keep\n');
  syncReviewCheckout(c.git);
  assert.equal(c.run(c.lane, ['rev-parse', 'HEAD']), c.main);
  assert.equal(readFileSync(join(c.lane, 'scratch.log'), 'utf8'), 'keep\n');
});

test('a checkout on a branch is detached at origin/main and the branch is not moved', (t) => {
  const c = clone(t);
  c.run(c.lane, ['switch', '-q', '-c', 'held', c.old]);
  syncReviewCheckout(c.git);
  assert.equal(c.run(c.lane, ['rev-parse', 'HEAD']), c.main);
  assert.equal(c.run(c.lane, ['rev-parse', 'held']), c.old);
  assert.equal(c.run(c.lane, ['rev-parse', '--abbrev-ref', 'HEAD']), 'HEAD');
});

test('a checkout already at origin/main stays there', (t) => {
  const c = clone(t);
  syncReviewCheckout(c.git);
  syncReviewCheckout(c.git);
  assert.equal(c.run(c.lane, ['rev-parse', 'HEAD']), c.main);
});

test('a missing origin/main refuses the round instead of reviewing whatever is checked out', (t) => {
  const c = clone(t);
  c.run(c.lane, ['update-ref', '-d', 'refs/remotes/origin/main']);
  assert.throws(() => syncReviewCheckout(c.git));
  assert.equal(c.run(c.lane, ['rev-parse', 'HEAD']), c.old);
});
