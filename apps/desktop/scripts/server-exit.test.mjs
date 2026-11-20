import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRestartBudget } from '../src/restart-budget.ts';
import { createServerExitHandler } from '../src/server-exit.ts';

function clock() {
  let at = 0;
  return { now: () => at, advance: (ms) => (at += ms) };
}

function harness({ stableMs = 60_000, max = 3, quitting = false } = {}) {
  const time = clock();
  const events = [];
  let server = null;
  const onExit = createServerExitHandler({
    budget: createRestartBudget(max, stableMs, time.now),
    hooks: {
      isQuitting: () => quitting,
      current: () => server,
      restart: (_dead, code) => events.push(['restart', code]),
      fatal: (code) => events.push(['fatal', code]),
    },
  });
  return {
    events,
    time,
    setQuitting(value) {
      quitting = value;
    },
    spawn() {
      const child = { exitCode: null };
      server = child;
      return child;
    },
    dropServer() {
      server = null;
    },
    onExit,
  };
}

test('a killed server restarts instead of fataling', () => {
  const h = harness();
  const child = h.spawn();
  h.onExit(child, 9);
  assert.deepEqual(h.events, [['restart', 9]]);
});

test('a server that keeps dying falls through to fatal after the budget', () => {
  const h = harness({ max: 3, stableMs: 60_000 });
  const child = h.spawn();
  h.onExit(child, 9);
  h.onExit(child, 9);
  h.onExit(child, 9);
  h.onExit(child, 9);
  assert.deepEqual(h.events, [
    ['restart', 9],
    ['restart', 9],
    ['restart', 9],
    ['fatal', 9],
  ]);
});

test('a server that lived past the stable window earns a fresh budget', () => {
  const h = harness({ max: 3, stableMs: 60_000 });
  const child = h.spawn();
  h.onExit(child, 9);
  h.onExit(child, 9);
  h.onExit(child, 9);
  h.time.advance(120_000);
  h.onExit(child, 9);
  assert.deepEqual(h.events.at(-1), ['restart', 9]);
});

test('exits while quitting or from a stale child are ignored', () => {
  const h = harness();
  const child = h.spawn();
  const stale = { exitCode: null };
  h.onExit(stale, 9);
  h.setQuitting(true);
  h.onExit(child, 9);
  assert.deepEqual(h.events, []);
});

test('a gate that handles the exit skips both restart and fatal', async () => {
  const time = clock();
  const events = [];
  let server = null;
  const onExit = createServerExitHandler({
    budget: createRestartBudget(3, 60_000, time.now),
    hooks: {
      isQuitting: () => false,
      current: () => server,
      gate: async () => true,
      restart: (_dead, code) => events.push(['restart', code]),
      fatal: (code) => events.push(['fatal', code]),
    },
  });
  const child = { exitCode: null };
  server = child;
  onExit(child, 9);
  await new Promise((done) => setTimeout(done, 0));
  assert.deepEqual(events, []);
});

test('a gate that declines falls through to the budget path', async () => {
  const time = clock();
  const events = [];
  let server = null;
  const onExit = createServerExitHandler({
    budget: createRestartBudget(3, 60_000, time.now),
    hooks: {
      isQuitting: () => false,
      current: () => server,
      gate: async () => false,
      restart: (_dead, code) => events.push(['restart', code]),
      fatal: (code) => events.push(['fatal', code]),
    },
  });
  const child = { exitCode: null };
  server = child;
  onExit(child, 9);
  await new Promise((done) => setTimeout(done, 0));
  assert.deepEqual(events, [['restart', 9]]);
});
