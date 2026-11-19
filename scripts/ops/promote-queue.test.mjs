import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropNotice, evaluate, planDrop, REQUIRED_CHECKS, threadOf } from './promote-queue.mjs';

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

test('requeued sha uses the latest check result regardless of response order', () => {
  const older = '2026-11-19T07:08:53Z';
  const newer = '2026-11-19T07:33:42Z';
  for (const [oldTiming, newTiming] of [
    [
      { completed_at: older, id: 9 },
      { completed_at: newer, id: 1 },
    ],
    [
      { started_at: older, id: 9 },
      { started_at: newer, id: 1 },
    ],
    [
      { completed_at: older, id: 9 },
      { completed_at: null, started_at: newer, id: 1 },
    ],
    [{ id: 1 }, { id: 9 }],
    [
      { completed_at: newer, id: 1 },
      { completed_at: newer, id: 9 },
    ],
  ]) {
    for (const conclusion of ['success', 'skipped', 'failure', 'cancelled', null]) {
      const latest = checks.map((check) => ({ ...check, ...newTiming, conclusion }));
      const previous = checks.map((check, index) => ({
        ...check,
        ...oldTiming,
        conclusion:
          conclusion === 'success' || conclusion === 'skipped'
            ? ['failure', 'cancelled', 'failure'][index]
            : 'success',
      }));
      for (const checkRuns of [
        [...latest, ...previous],
        [...previous, ...latest],
      ]) {
        assert.deepEqual(
          evaluate({ ...base, checkRuns }),
          conclusion === 'success' || conclusion === 'skipped'
            ? { action: 'promote', sha: SHA }
            : { action: 'wait', reason: 'checks pending: check, pack-smoke, e2e-gate' },
        );
      }
    }
  }
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

const failedJobs = [
  { name: 'check-core', conclusion: 'failure' },
  { name: 'vitest-light', conclusion: 'success' },
  { name: 'e2e', conclusion: 'cancelled' },
];

test('a red run with a failed job is rerun once, then dropped after the rerun stays red', () => {
  const first = run({ conclusion: 'failure', run_attempt: 1, id: 7 });
  assert.deepEqual(evaluate({ ...base, ciRuns: [first], jobs: failedJobs }), {
    action: 'retry',
    reason: 'ci failure in check-core',
    sha: SHA,
    runId: 7,
    runUrl: undefined,
    failedJobs: ['check-core'],
  });
  const second = run({ conclusion: 'failure', run_attempt: 2, id: 7 });
  assert.equal(evaluate({ ...base, ciRuns: [second], jobs: failedJobs }).action, 'drop');
});

test('a red run whose only non-green jobs were cancelled is not a real failure', () => {
  const jobs = [
    { name: 'check-core', conclusion: 'success' },
    { name: 'e2e', conclusion: 'cancelled' },
  ];
  const verdict = evaluate({ ...base, ciRuns: [run({ conclusion: 'failure' })], jobs });
  assert.equal(verdict.action, 'reject');
});

test('a timed out job counts as a failed job', () => {
  const jobs = [{ name: 'e2e', conclusion: 'timed_out' }];
  const verdict = evaluate({ ...base, ciRuns: [run({ conclusion: 'failure' })], jobs });
  assert.equal(verdict.action, 'retry');
});

test('threadOf reads the last Amp-Thread-ID trailer, as a URL or a bare id', () => {
  assert.equal(threadOf('subject\n\nbody\n'), null);
  assert.equal(
    threadOf(
      's\n\nAmp-Thread-ID: https://ampcode.com/threads/T-01a1f406-0526-758a-9293-f3cf47c2e3e8\n',
    ),
    'T-01a1f406-0526-758a-9293-f3cf47c2e3e8',
  );
  assert.equal(threadOf('s\n\nAmp-Thread-ID: T-aaaa-1\nAmp-Thread-ID: T-bbbb-2\n'), 'T-bbbb-2');
});

const commit = (sha, thread) => ({ sha, subject: sha, thread });

test('planDrop takes the consecutive commits of the head owner and keeps the rest', () => {
  assert.deepEqual(planDrop([commit('a', 'T-1'), commit('b', 'T-2'), commit('c', 'T-2')]), {
    dropped: [commit('b', 'T-2'), commit('c', 'T-2')],
    keepTip: 'a',
  });
});

test('planDrop does not split an owner run and never drops an earlier run of the same owner', () => {
  const chain = [commit('a', 'T-2'), commit('b', 'T-1'), commit('c', 'T-2')];
  assert.deepEqual(planDrop(chain), { dropped: [commit('c', 'T-2')], keepTip: 'b' });
});

test('planDrop drops unmarked candidates directly and deletes the queue when everything goes', () => {
  assert.deepEqual(planDrop([commit('a', null), commit('b', null)]), {
    dropped: [commit('a', null), commit('b', null)],
    keepTip: null,
  });
  assert.deepEqual(planDrop([commit('a', 'T-1'), commit('b', null)]), {
    dropped: [commit('b', null)],
    keepTip: 'a',
  });
  assert.deepEqual(planDrop([]), { dropped: [], keepTip: null });
});

test('the drop notice names the owners and the run, or says no owner is marked', () => {
  const verdict = { failedJobs: ['check-core'], runUrl: 'https://example.test/run/1' };
  const marked = dropNotice({
    verdict,
    dropped: [commit('a'.repeat(40), 'T-1')],
    keepTip: null,
  });
  assert.match(marked, /https:\/\/ampcode\.com\/threads\/T-1/);
  assert.match(marked, /check-core/);
  assert.match(marked, /queue\/main was deleted/);
  const unmarked = dropNotice({
    verdict,
    dropped: [commit('b'.repeat(40), null)],
    keepTip: 'c'.repeat(40),
  });
  assert.match(unmarked, /No Amp-Thread-ID/);
  assert.match(unmarked, /ccccccccc/);
});
