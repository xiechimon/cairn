import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { nativeTrayMenuSchema } from '@cairn/shared/desktop-shell';
import {
  nativeTrayAction,
  skeletonTrayMenu,
  startNativeTray,
  withHostState,
} from '../src/native-tray.ts';
import { createRestartBudget } from '../src/restart-budget.ts';

const fake = fileURLToPath(new URL('./fixtures/fake-tray-helper.mjs', import.meta.url));

const menu = {
  label: 'Cairn',
  items: [
    {
      kind: 'row',
      id: 'coordinator',
      title: 'Coordinator',
      image: 'brand',
      open: { kind: 'path', path: '/app' },
    },
    { kind: 'header', id: 'waiting', title: '等你' },
    { kind: 'row', id: 'user', title: '本地用户', image: 'user' },
    { kind: 'switch', id: 'runner', title: '本机执行机', on: true, enabled: true },
    { kind: 'header', id: 'keep-awake-title', title: '有任务运行时保持唤醒' },
    { kind: 'choice', id: 'keep-awake-screen-on', title: '屏幕常亮', on: false, enabled: true },
    { kind: 'choice', id: 'keep-awake-system', title: '屏幕可熄灭', on: true, enabled: true },
    {
      kind: 'choice',
      id: 'keep-awake-lid-closed',
      title: '合盖继续运行',
      on: false,
      enabled: true,
    },
    { kind: 'command', id: 'settings', title: '设置', key: ',' },
    { kind: 'separator', id: 'account-rule' },
    { kind: 'command', id: 'quit', title: '退出 Cairn', key: 'q' },
  ],
};

function harness(
  modes,
  { budget = createRestartBudget(3, 60_000), command = process.execPath, readyMs = 2_000 } = {},
) {
  const queue = [...modes];
  const seen = [];
  const waiters = [];
  const note = (entry) => {
    seen.push(entry);
    for (const waiter of [...waiters]) {
      if (waiter.match(seen)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  };
  const tray = startNativeTray({
    command,
    args: [fake],
    spawn: (cmd, args, options) =>
      spawn(cmd, [...args, queue.length > 1 ? queue.shift() : queue[0]], options),
    budget,
    readyMs,
    delaysMs: [20, 40, 80],
    host: {
      up: () => note('up'),
      down: () => note('down'),
      event: (event) => note(event.type === 'action' ? `action:${event.id}` : event.type),
      log: (line) => note(`log:${line}`),
    },
  });
  const until = (match, ms = 5_000) =>
    new Promise((resolve, reject) => {
      if (match(seen)) {
        resolve();
        return;
      }
      const timer = setTimeout(
        () => reject(new Error(`timed out; saw ${JSON.stringify(seen)}`)),
        ms,
      );
      waiters.push({
        match,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  const lifecycle = () => seen.filter((entry) => entry === 'up' || entry === 'down');
  return { tray, seen, until, lifecycle };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a ready helper gets the menu and reports opens, picks and closes', async () => {
  nativeTrayMenuSchema.parse(menu);
  const { tray, until, seen } = harness(['ok']);
  await until((list) => list.includes('up'));
  assert.equal(tray.isUp(), true);
  tray.send({ type: 'menu', menu });
  await until((list) => list.includes('closed'));
  assert.deepEqual(
    seen.filter((entry) => !entry.startsWith('log:')),
    ['up', 'opened', ...menu.items.map((item) => `action:${item.id}`), 'closed'],
  );
  assert.ok(seen.includes('log:helper says hello'));
  tray.stop();
});

test('picked ids map to what main does, and nothing else opens anything', () => {
  assert.deepEqual(nativeTrayAction(menu, 'coordinator'), {
    kind: 'open',
    target: { kind: 'path', path: '/app' },
  });
  assert.deepEqual(nativeTrayAction(menu, 'runner'), { kind: 'runner', on: false });
  assert.deepEqual(nativeTrayAction(menu, 'keep-awake-screen-on'), {
    kind: 'keep-awake',
    mode: 'screen-on',
  });
  assert.deepEqual(nativeTrayAction(menu, 'settings'), {
    kind: 'open',
    target: { kind: 'command', command: 'settings' },
  });
  assert.deepEqual(nativeTrayAction(menu, 'quit'), { kind: 'quit' });
  for (const id of ['user', 'waiting', 'account-rule', '/etc/passwd', 42, undefined]) {
    assert.equal(nativeTrayAction(menu, id), null, String(id));
  }
  const starting = {
    ...menu,
    items: menu.items.map((item) => (item.id === 'runner' ? { ...item, enabled: false } : item)),
  };
  assert.equal(nativeTrayAction(starting, 'runner'), null);
});

test('the skeleton opens Cairn, keeps the screen on and quits, in both languages', () => {
  for (const [locale, open] of [
    ['zh', '打开 Cairn'],
    ['en', 'Open Cairn'],
  ]) {
    const skeleton = skeletonTrayMenu(locale);
    nativeTrayMenuSchema.parse(skeleton);
    assert.equal(skeleton.items[0].title, open);
    assert.deepEqual(nativeTrayAction(skeleton, 'open'), {
      kind: 'open',
      target: { kind: 'path', path: '/app' },
    });
    assert.deepEqual(nativeTrayAction(skeleton, 'keep-awake-system'), {
      kind: 'keep-awake',
      mode: 'system',
    });
    assert.deepEqual(nativeTrayAction(skeleton, 'quit'), { kind: 'quit' });
  }
});

test('the keep-awake choices show main state, not the page snapshot', () => {
  const merged = withHostState(menu, {
    keepAwake: 'lid-closed',
    lidClosedAvailable: true,
    runner: 'on',
  });
  const choices = merged.items.flatMap((item) => (item.kind === 'disclosure' ? item.children : []));
  assert.equal(choices.find((item) => item.id === 'keep-awake-lid-closed').on, true);
  assert.equal(choices.find((item) => item.id === 'keep-awake-system').on, false);
});

test('a crash brings the fallback at once and a restart takes it away', async () => {
  const { tray, until, lifecycle } = harness(['ok', 'ok']);
  await until((list) => list.includes('up'));
  tray.send({ type: 'crash' });
  await until(() => lifecycle().length === 3);
  assert.deepEqual(lifecycle(), ['up', 'down', 'up']);
  tray.stop();
});

test('three quick crashes leave the fallback for the session', async () => {
  const { tray, until, seen, lifecycle } = harness(['crash']);
  await until((list) => list.some((entry) => entry.includes('keeps failing')));
  await pause(300);
  assert.deepEqual(lifecycle(), ['down']);
  assert.equal(seen.filter((entry) => entry.includes('the native tray stopped')).length, 4);
  assert.equal(tray.isUp(), false);
  tray.stop();
});

test('a missing helper binary falls back', async () => {
  const { tray, until } = harness(['ok'], {
    command: '/nonexistent/CairnTray',
    budget: createRestartBudget(0, 60_000),
  });
  await until(
    (list) => list.includes('down') && list.some((entry) => entry.includes('keeps failing')),
  );
  assert.equal(tray.isUp(), false);
  tray.stop();
});

test('a helper that never says ready is killed and falls back', async () => {
  const { tray, until } = harness(['silent'], {
    readyMs: 150,
    budget: createRestartBudget(0, 60_000),
  });
  await until(
    (list) => list.includes('down') && list.some((entry) => entry.includes('no ready in 150 ms')),
  );
  assert.equal(tray.isUp(), false);
  tray.stop();
});

test('unreadable lines are logged and dropped', async () => {
  const { tray, until, seen } = harness(['noisy']);
  await until((list) => list.includes('up'));
  assert.ok(seen.some((entry) => entry.includes('unreadable line: not json')));
  assert.ok(seen.some((entry) => entry.includes('unreadable line: {"type":"mystery"}')));
  tray.stop();
});

test('stopping on quit closes the helper and nothing restarts', async () => {
  const { tray, until, seen, lifecycle } = harness(['ok']);
  await until((list) => list.includes('up'));
  tray.stop();
  await pause(300);
  assert.deepEqual(lifecycle(), ['up']);
  assert.ok(!seen.some((entry) => entry.includes('stopped')));
});
