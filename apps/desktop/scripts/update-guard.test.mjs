import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  armGuard,
  GUARD_HEALTHY_AFTER_MS,
  GUARD_MAX_ROLLBACKS,
  guardStep,
} from '../src/update-guard.ts';

function armed(now = 1_000) {
  return armGuard(0, now);
}

test('a server that exits before it is ready rolls the update back', () => {
  const step = guardStep(armed(), { event: 'server-exit', at: 4_000 });
  assert.equal(step.action, 'rollback');
  assert.equal(step.state.rollbacks, 1);
});

test('a launch that fails once while the update is on probation rolls it back', () => {
  const step = guardStep(armed(), { event: 'boot-failed', at: 2_000 });
  assert.equal(step.action, 'rollback');
});

test('one failed health probe is noise, three in a row roll the update back', () => {
  const first = guardStep(armed(), { event: 'health-failed', at: 2_000 });
  const second = guardStep(first.state, { event: 'health-failed', at: 3_000 });
  const third = guardStep(second.state, { event: 'health-failed', at: 4_000 });
  assert.equal(first.action, 'none');
  assert.equal(second.action, 'none');
  assert.equal(third.action, 'rollback');
});

test('a health probe that answers clears the failures before it', () => {
  const failed = guardStep(armed(), { event: 'health-failed', at: 2_000 }).state;
  const answered = guardStep(failed, { event: 'health-ok', at: 3_000 }).state;
  const after = guardStep(answered, { event: 'health-failed', at: 4_000 });
  assert.equal(after.action, 'none');
  assert.equal(after.state.failures, 1);
});

test('a server that answers for thirty seconds keeps the new version', () => {
  let state = guardStep(armed(), { event: 'health-ok', at: 5_000 }).state;
  assert.equal(
    guardStep(state, { event: 'tick', at: 5_000 + GUARD_HEALTHY_AFTER_MS - 1 }).action,
    'none',
  );
  state = guardStep(state, { event: 'health-ok', at: 20_000 }).state;
  const confirmed = guardStep(state, { event: 'tick', at: 20_000 + GUARD_HEALTHY_AFTER_MS });
  assert.equal(confirmed.action, 'confirm');
  assert.equal(confirmed.state.phase, 'healthy');
});

test('a server that dies inside the healthy window rolls back', () => {
  const state = guardStep(armed(), { event: 'health-ok', at: 5_000 }).state;
  const step = guardStep(state, { event: 'server-exit', at: 20_000 });
  assert.equal(step.action, 'rollback');
});

test('a server that dies long after it was confirmed is not rolled back', () => {
  const state = guardStep(armed(), { event: 'health-ok', at: 5_000 }).state;
  const confirmed = guardStep(state, { event: 'tick', at: 40_000 }).state;
  assert.equal(guardStep(confirmed, { event: 'server-exit', at: 9_000_000 }).action, 'none');
});

test('the same version is not rolled back more than twice', () => {
  const first = guardStep(armGuard(0, 1_000), { event: 'server-exit', at: 2_000 });
  const second = guardStep(armGuard(first.state.rollbacks, 3_000), {
    event: 'server-exit',
    at: 4_000,
  });
  const third = guardStep(armGuard(second.state.rollbacks, 5_000), {
    event: 'server-exit',
    at: 6_000,
  });
  assert.equal(first.action, 'rollback');
  assert.equal(second.action, 'rollback');
  assert.equal(third.action, 'none');
  assert.equal(third.state.rollbacks, GUARD_MAX_ROLLBACKS);
});

test('a version that never comes up is rolled back once the health window closes', () => {
  const step = guardStep(armed(), { event: 'tick', at: 1_000 + 61_000 });
  assert.equal(step.action, 'rollback');
});

test('a configured rollback budget of zero never rolls back', () => {
  const step = guardStep(armGuard(GUARD_MAX_ROLLBACKS, 1_000), { event: 'server-exit', at: 2_000 });
  assert.equal(step.action, 'none');
});
