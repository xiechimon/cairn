import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createKeepAwake } from '../src/keep-awake.ts';
import { trayMenuTemplate } from '../src/tray-menu.ts';

function fakeBlocker() {
  const active = new Set();
  let next = 1;
  return {
    active,
    start(type) {
      assert.equal(type, 'prevent-app-suspension');
      const id = next++;
      active.add(id);
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

test('the tray item is a checkbox that shows the state and asks for the opposite', () => {
  const asked = [];
  const actions = { open() {}, quit() {}, setKeepAwake: (on) => asked.push(on) };
  for (const on of [false, true]) {
    const item = trayMenuTemplate('127.0.0.1:1', on, actions).find(
      (entry) => entry.label === 'Keep the Mac Awake',
    );
    assert.equal(item?.type, 'checkbox');
    assert.equal(item?.checked, on);
    item.click();
  }
  assert.deepEqual(asked, [true, false]);
});
