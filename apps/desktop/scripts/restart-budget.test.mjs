import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRestartBudget } from '../src/restart-budget.ts';

function clock() {
  let at = 0;
  return { now: () => at, advance: (ms) => (at += ms) };
}

test('a runner that keeps crashing at once is given up after the limit', () => {
  const time = clock();
  const budget = createRestartBudget(3, 60_000, time.now);
  const answers = [];
  for (let i = 0; i < 5; i += 1) {
    budget.started();
    time.advance(1_000);
    answers.push(budget.exited());
  }
  assert.deepEqual(answers, [true, true, true, false, false]);
});

test('a runner that ran long enough before exiting earns a fresh budget', () => {
  const time = clock();
  const budget = createRestartBudget(3, 60_000, time.now);
  for (let day = 0; day < 10; day += 1) {
    budget.started();
    time.advance(3_600_000);
    assert.equal(budget.exited(), true, `exit on day ${day}`);
  }
});

test('reset gives an exhausted budget its restarts back', () => {
  const time = clock();
  const budget = createRestartBudget(1, 60_000, time.now);
  budget.started();
  assert.equal(budget.exited(), true);
  budget.started();
  assert.equal(budget.exited(), false);
  budget.reset();
  budget.started();
  assert.equal(budget.exited(), true);
});
