import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, REQUIRED_CHECKS } from './promote-queue.mjs';

const SHA = 'a'.repeat(40);
const run = (over) => ({
  head_sha: SHA,
  head_branch: 'queue/main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  ...over,
});
const checks = REQUIRED_CHECKS.map((name) => ({ name, conclusion: 'success' }));
const base = {
  queueHead: SHA,
  ciRuns: [run()],
  checkRuns: checks,
  mainTip: 'b'.repeat(40),
  candidateContainsMain: true,
};

test('green run on the queue head promotes that exact sha', () => {
  assert.deepEqual(evaluate(base), { action: 'promote', sha: SHA });
});

test('no run, running run or pending check waits', () => {
  assert.equal(evaluate({ ...base, ciRuns: [] }).action, 'wait');
  assert.equal(
    evaluate({ ...base, ciRuns: [run({ status: 'in_progress', conclusion: null })] }).action,
    'wait',
  );
  assert.equal(
    evaluate({ ...base, checkRuns: checks.filter((c) => c.name !== 'e2e-gate') }).action,
    'wait',
  );
});

test('cancelled or failed run never counts as green', () => {
  assert.equal(evaluate({ ...base, ciRuns: [run({ conclusion: 'cancelled' })] }).action, 'reject');
  assert.equal(evaluate({ ...base, ciRuns: [run({ conclusion: 'failure' })] }).action, 'reject');
});

test('a check skipped by classification counts the same as the ruleset does', () => {
  const skipped = checks.map((c) =>
    c.name === 'pack-smoke' ? { ...c, conclusion: 'skipped' } : c,
  );
  assert.deepEqual(evaluate({ ...base, checkRuns: skipped }), {
    action: 'promote',
    sha: SHA,
  });
});

test('stale candidate that no longer contains main is refused', () => {
  assert.equal(evaluate({ ...base, candidateContainsMain: false }).action, 'reject');
});

test('a successful run for a different sha or branch does not promote', () => {
  const other = run({ head_sha: 'c'.repeat(40) });
  assert.equal(evaluate({ ...base, ciRuns: [other] }).action, 'wait');
  const wrongBranch = run({ head_branch: 'main' });
  assert.equal(evaluate({ ...base, ciRuns: [wrongBranch] }).action, 'wait');
});
