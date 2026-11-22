import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createKeepAwake } from '../src/keep-awake.ts';
import { trayMenuTemplate } from '../src/tray-menu.ts';
import {
  createWakeAhead,
  earliestNextRunAt,
  WAKE_AHEAD_LEAD_MS,
  WAKE_AHEAD_TRAIL_MS,
  wakeAheadActive,
} from '../src/wake-ahead.ts';

function fakeBlocker() {
  const active = new Map();
  let next = 1;
  return {
    active,
    types: () => [...active.values()],
    start(type) {
      const id = next++;
      active.set(id, type);
      return id;
    },
    stop(id) {
      assert.ok(active.delete(id), `stopped unknown blocker ${id}`);
    },
  };
}

function choicePath() {
  return join(mkdtempSync(join(tmpdir(), 'cairn-keep-awake-')), 'keep-awake');
}

test('keep awake starts off and holds no blocker', () => {
  const blocker = fakeBlocker();
  const keepAwake = createKeepAwake(blocker, choicePath());
  assert.equal(keepAwake.isOn(), false);
  assert.equal(blocker.active.size, 0);
});

test('turning keep awake on holds exactly one blocker until it is turned off', () => {
  const blocker = fakeBlocker();
  const keepAwake = createKeepAwake(blocker, choicePath());
  keepAwake.set(true);
  keepAwake.set(true);
  assert.equal(keepAwake.isOn(), true);
  assert.equal(blocker.active.size, 1);
  keepAwake.set(false);
  assert.equal(keepAwake.isOn(), false);
  assert.equal(blocker.active.size, 0);
});

test('the button keeps the screen on, wake-ahead only keeps the Mac running, and the screen wins', () => {
  const blocker = fakeBlocker();
  const keepAwake = createKeepAwake(blocker, choicePath());
  const steps = [
    [true, false, ['prevent-display-sleep']],
    [true, true, ['prevent-display-sleep']],
    [false, true, ['prevent-app-suspension']],
    [false, false, []],
    [false, true, ['prevent-app-suspension']],
    [true, true, ['prevent-display-sleep']],
    [true, false, ['prevent-display-sleep']],
    [false, false, []],
  ];
  for (const [manual, wakeAhead, expected] of steps) {
    keepAwake.set(manual);
    keepAwake.setWakeAhead(wakeAhead);
    assert.deepEqual(blocker.types(), expected, `manual=${manual} wakeAhead=${wakeAhead}`);
    assert.equal(keepAwake.isOn(), manual);
    assert.equal(keepAwake.isHolding(), expected.length > 0);
  }
});

test('the choice survives a restart', () => {
  const path = choicePath();
  createKeepAwake(fakeBlocker(), path).set(true);
  assert.equal(readFileSync(path, 'utf8'), 'on\n');
  const blocker = fakeBlocker();
  assert.equal(createKeepAwake(blocker, path).isOn(), true);
  assert.equal(blocker.active.size, 1);
  createKeepAwake(fakeBlocker(), path).set(false);
  assert.equal(createKeepAwake(fakeBlocker(), path).isOn(), false);
});

test('wake-ahead holds the blocker only inside the run window', async () => {
  const blocker = fakeBlocker();
  const keepAwake = createKeepAwake(blocker, choicePath());
  let nextRun = null;
  let now = 10_000_000;
  const wakeAhead = createWakeAhead({
    nextRunAt: async () => nextRun,
    onWindow: (active) => keepAwake.setWakeAhead(active),
    now: () => now,
  });
  await wakeAhead.pollNow();
  assert.equal(blocker.active.size, 0);
  nextRun = now + WAKE_AHEAD_LEAD_MS + 60_000;
  await wakeAhead.pollNow();
  assert.equal(blocker.active.size, 0);
  nextRun = now + WAKE_AHEAD_LEAD_MS;
  await wakeAhead.pollNow();
  assert.equal(blocker.active.size, 1);
  now = nextRun;
  await wakeAhead.pollNow();
  assert.equal(blocker.active.size, 1);
  now = nextRun + WAKE_AHEAD_TRAIL_MS + 1;
  await wakeAhead.pollNow();
  assert.equal(blocker.active.size, 0);
  wakeAhead.stop();
});

test('manual keep-awake is an override that survives the wake-ahead window', async () => {
  const blocker = fakeBlocker();
  const keepAwake = createKeepAwake(blocker, choicePath());
  keepAwake.set(true);
  let nextRun = null;
  const wakeAhead = createWakeAhead({
    nextRunAt: async () => nextRun,
    onWindow: (active) => keepAwake.setWakeAhead(active),
    now: () => 10_000_000,
  });
  await wakeAhead.pollNow();
  assert.equal(blocker.active.size, 1);
  nextRun = 10_000_000 + 10 * 60_000;
  await wakeAhead.pollNow();
  assert.equal(blocker.active.size, 1);
  keepAwake.set(false);
  assert.equal(blocker.active.size, 1);
  keepAwake.setWakeAhead(false);
  assert.equal(blocker.active.size, 0);
  wakeAhead.stop();
});

test('a failed schedule fetch keeps the previous wake-ahead state', async () => {
  const blocker = fakeBlocker();
  const keepAwake = createKeepAwake(blocker, choicePath());
  let nextRun = 10_000_000 + 10 * 60_000;
  const wakeAhead = createWakeAhead({
    nextRunAt: async () => {
      if (nextRun === 'fail') throw new Error('offline');
      return nextRun;
    },
    onWindow: (active) => keepAwake.setWakeAhead(active),
    now: () => 10_000_000,
  });
  await wakeAhead.pollNow();
  assert.equal(blocker.active.size, 1);
  nextRun = 'fail';
  await wakeAhead.pollNow();
  assert.equal(blocker.active.size, 1);
  wakeAhead.stop();
});

test('earliestNextRunAt picks the soonest enabled run and skips disabled or unscheduled rows', () => {
  assert.equal(
    earliestNextRunAt([
      { enabled: true, nextRunAt: 500 },
      { enabled: false, nextRunAt: 100 },
      { enabled: true, nextRunAt: null },
      { enabled: true, nextRunAt: 250 },
    ]),
    250,
  );
  assert.equal(earliestNextRunAt([{ enabled: true, nextRunAt: null }]), null);
  assert.equal(wakeAheadActive(1000, 1000 - WAKE_AHEAD_LEAD_MS), true);
  assert.equal(wakeAheadActive(1000, 1000 + WAKE_AHEAD_TRAIL_MS), true);
  assert.equal(wakeAheadActive(1000, 1000 + WAKE_AHEAD_TRAIL_MS + 1), false);
  assert.equal(wakeAheadActive(1000, 1000 - WAKE_AHEAD_LEAD_MS - 1), false);
});

test('the tray item is a checkbox that shows the state and asks for the opposite', () => {
  const asked = [];
  const actions = { open() {}, quit() {}, setKeepAwake: (on) => asked.push(on) };
  for (const on of [false, true]) {
    const item = trayMenuTemplate('127.0.0.1:1', on, actions).find(
      (entry) => entry.label === 'Keep the Screen On',
    );
    assert.equal(item?.type, 'checkbox');
    assert.equal(item?.checked, on);
    item.click();
  }
  assert.deepEqual(asked, [true, false]);
});
