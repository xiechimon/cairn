import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awaitMainHealth, decideMainHealth } from './await-main-health.mjs';

const run = (id, name, status, conclusion = null) => ({ id, name, status, conclusion });
const green = [run(1, 'check', 'completed', 'success'), run(2, 'e2e-gate', 'completed', 'success')];

function harness(snapshots, timeoutMs = 1000) {
  let clock = 0;
  let calls = 0;
  const sleeps = [];
  const promise = awaitMainHealth({
    fetchCheckRuns: async () => snapshots[Math.min(calls++, snapshots.length - 1)],
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    timeoutMs,
    intervalMs: 100,
  });
  return { promise, sleeps };
}

test('both required checks succeeded -> success', () => {
  assert.equal(decideMainHealth(green).verdict, 'success');
});

test('a failed required check -> red', () => {
  const runs = [
    run(1, 'check', 'completed', 'success'),
    run(2, 'e2e-gate', 'completed', 'failure'),
  ];
  assert.deepEqual(decideMainHealth(runs), { verdict: 'red', detail: 'e2e-gate=failure' });
});

test('skipped, cancelled, neutral and timed-out conclusions are red', () => {
  for (const conclusion of ['skipped', 'cancelled', 'neutral', 'timed_out']) {
    const runs = [run(1, 'check', 'completed', conclusion), green[1]];
    assert.equal(decideMainHealth(runs).verdict, 'red', conclusion);
  }
});

test('an absent required check -> missing', () => {
  assert.deepEqual(decideMainHealth([green[0]]), { verdict: 'missing', detail: 'e2e-gate' });
  assert.equal(decideMainHealth([]).verdict, 'missing');
});

test('an unfinished required check -> pending', () => {
  const runs = [green[0], run(2, 'e2e-gate', 'in_progress')];
  assert.deepEqual(decideMainHealth(runs), { verdict: 'pending', detail: 'e2e-gate' });
});

test('red wins over missing', () => {
  assert.equal(decideMainHealth([run(1, 'check', 'completed', 'failure')]).verdict, 'red');
});

test('only the latest rerun of a check counts', () => {
  const rerunGreen = [
    run(1, 'check', 'completed', 'failure'),
    run(9, 'check', 'completed', 'success'),
    green[1],
  ];
  assert.equal(decideMainHealth(rerunGreen).verdict, 'success');
  const rerunRed = [
    run(1, 'check', 'completed', 'success'),
    run(9, 'check', 'completed', 'failure'),
    green[1],
  ];
  assert.equal(decideMainHealth(rerunRed).verdict, 'red');
});

test('unrelated check names do not satisfy the requirement', () => {
  const runs = [
    run(1, 'check-core', 'completed', 'success'),
    run(2, 'e2e-gate', 'completed', 'success'),
  ];
  assert.equal(decideMainHealth(runs).verdict, 'missing');
});

test('red refuses immediately without waiting', async () => {
  const h = harness([[run(1, 'check', 'completed', 'failure'), green[1]]]);
  const result = await h.promise;
  assert.equal(result.ok, false);
  assert.equal(result.verdict, 'red');
  assert.deepEqual(h.sleeps, []);
});

test('missing refuses after the timeout', async () => {
  const h = harness([[green[0]]], 450);
  const result = await h.promise;
  assert.equal(result.ok, false);
  assert.equal(result.verdict, 'timeout-missing');
  assert.equal(h.sleeps.length, 4);
});

test('pending then success proceeds', async () => {
  const h = harness([
    [green[0], run(2, 'e2e-gate', 'queued')],
    [green[0], run(2, 'e2e-gate', 'in_progress')],
    green,
  ]);
  const result = await h.promise;
  assert.equal(result.ok, true);
  assert.equal(h.sleeps.length, 2);
});

test('pending past the timeout refuses', async () => {
  const h = harness([[green[0], run(2, 'e2e-gate', 'in_progress')]], 300);
  const result = await h.promise;
  assert.equal(result.ok, false);
  assert.equal(result.verdict, 'timeout-pending');
});

test('pending then red refuses', async () => {
  const h = harness([
    [green[0], run(2, 'e2e-gate', 'in_progress')],
    [green[0], run(2, 'e2e-gate', 'completed', 'failure')],
  ]);
  const result = await h.promise;
  assert.equal(result.verdict, 'red');
});

test('a fetch error propagates so the caller fails closed', async () => {
  await assert.rejects(
    awaitMainHealth({
      fetchCheckRuns: async () => {
        throw new Error('boom');
      },
      sleep: async () => {},
    }),
    /boom/,
  );
});
