import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trayGroups } from '../src/tray-data.ts';
import { trayMenuTemplate, traySettingsPath } from '../src/tray-menu.ts';

const state = {
  locale: 'en',
  keepAwake: false,
  runner: 'on',
  data: {
    status: 'ready',
    displayName: 'Local owner',
    coordinatorBusy: false,
    groups: [],
    usage: null,
  },
};

function build(overrides = {}) {
  const calls = [];
  const items = trayMenuTemplate(
    { ...state, ...overrides },
    {
      open: (path) => calls.push(['open', path]),
      settings: () => calls.push(['settings']),
      setRunner: (on) => calls.push(['runner', on]),
      setKeepAwake: (on) => calls.push(['awake', on]),
      quit: () => calls.push(['quit']),
    },
  );
  return { items, calls, item: (id) => items.find((row) => row.id === id) };
}

for (const [runner, checked, enabled, status] of [
  ['starting', true, false, 'Local Runner: Starting'],
  ['on', true, true, null],
  ['stopping', false, false, 'Local Runner: Stopping'],
  ['off', false, true, null],
  ['failed', false, true, 'Local Runner: Stopped unexpectedly'],
]) {
  test(`native Runner checkbox and status when ${runner}`, () => {
    const { calls, item } = build({ runner });
    assert.equal(item('runner').type, 'checkbox');
    assert.equal(item('runner').checked, checked);
    assert.equal(item('runner').enabled, enabled);
    const statusItem = item('runner-status');
    if (status === null) assert.equal(statusItem, undefined);
    else {
      assert.equal(statusItem.enabled, false);
      assert.equal(statusItem.label, status);
    }
    if (enabled) item('runner').click();
    assert.deepEqual(calls, enabled ? [['runner', !checked]] : []);
  });
}

for (const keepAwake of [false, true]) {
  test(`native screen-awake checkbox when ${keepAwake ? 'on' : 'off'}`, () => {
    const { calls, item } = build({ keepAwake });
    assert.equal(item('keep-awake').type, 'checkbox');
    assert.equal(item('keep-awake').checked, keepAwake);
    item('keep-awake').click();
    assert.deepEqual(calls, [['awake', !keepAwake]]);
  });
}

test('Settings raises the current section without resetting an active sign-in', () => {
  const origin = 'http://127.0.0.1:4110';
  assert.equal(traySettingsPath(`${origin}/app/settings`, origin), null);
  assert.equal(traySettingsPath(`${origin}/app/settings/models?project=1#agy`, origin), null);
  for (const url of [
    '',
    `${origin}/app`,
    `${origin}/app/settings-old`,
    'https://example.test/app/settings/models',
  ]) {
    assert.equal(traySettingsPath(url, origin), '/app/settings');
  }
});

test('opens Coordinator, settings and quit even without workspace data', () => {
  const { calls, items, item } = build({ data: { status: 'loading' } });
  assert.equal(items[0].id, 'coordinator');
  assert.ok(!items.some((row) => row.id === 'server' || row.label?.includes('127.0.0.1')));
  assert.equal(item('data-status').label, 'Loading workspace status');
  assert.equal(item('data-status').enabled, false);
  assert.ok(!items.some((row) => row.id === 'no-tasks' || row.id === 'usage'));
  for (const id of ['coordinator', 'settings', 'quit']) item(id).click();
  assert.deepEqual(calls, [['open', '/app'], ['settings'], ['quit']]);
  assert.equal(item('quit').accelerator, 'CommandOrControl+Q');
});

test('reports unavailable workspace as distinct from a successfully loaded empty menu', () => {
  assert.equal(
    build({ data: { status: 'unavailable' } }).item('data-status').label,
    'Workspace status unavailable',
  );
  const { items, item } = build();
  assert.equal(item('no-tasks').label, 'No tasks need your attention');
  assert.equal(item('no-tasks').enabled, false);
  assert.equal(item('owner').label, 'Local owner');
  assert.equal(item('owner').enabled, false);
  assert.ok(!items.some((row) => row.id === 'usage' || row.id === 'coordinator-status'));
});

test('uses the unified stalled and Runner queue wording in both locales', () => {
  const now = 60 * 60_000;
  const groups = trayGroups(
    { entries: [] },
    [
      {
        id: 'mac',
        name: 'Test Mac',
        kind: 'local',
        online: true,
        running: [{ threadId: 'report', title: 'Report', startedAt: now - 16 * 60_000 }],
        queued: [{ threadId: 'review', title: 'Review', reason: 'waiting', retryAt: null }],
      },
    ],
    now,
  );
  for (const [locale, labels] of [
    ['zh', ['Report · 16 分钟无进展', 'Review · 等待这台执行机空闲']],
    ['en', ['Report · No progress for 16m', 'Review · Waiting for this Runner to free up']],
  ]) {
    const { items } = build({ locale, data: { ...state.data, groups } });
    assert.deepEqual(
      items.filter((row) => row.id === undefined && row.click).map((row) => row.label),
      labels,
    );
  }
});

test('the Chinese menu keeps an unexpected Runner stop visible and restartable', () => {
  const { calls, item } = build({ locale: 'zh', runner: 'failed' });
  assert.equal(item('runner-status').label, '本机执行机：异常停止');
  assert.equal(item('runner-status').enabled, false);
  assert.equal(item('runner').label, '本机执行机');
  assert.equal(item('runner').checked, false);
  item('runner').click();
  assert.deepEqual(calls, [['runner', true]]);
});

test('localizes status and keeps all navigation items actionable', () => {
  const { calls, items, item } = build({
    locale: 'zh',
    data: {
      ...state.data,
      coordinatorBusy: true,
      usage: { tokens: 12500, quota: { state: 'exhausted', retryAt: null } },
      groups: [
        {
          label: { kind: 'waiting' },
          rows: [{ title: 'Review\nnotes', path: '/app?thread=review' }],
        },
        {
          label: {
            kind: 'machine',
            name: 'Test Mac',
            pressure: { percent: 95, level: 'full', memory: 95, cpu: 20, disk: 18 },
          },
          rows: [
            {
              title: 'Queued task',
              path: '/app?thread=queued',
              status: { kind: 'waiting-for-runner' },
            },
          ],
        },
        { label: { kind: 'working' }, rows: [{ title: 'Working task', path: '/app?thread=work' }] },
      ],
    },
  });
  assert.equal(item('runner').label, '本机执行机');
  assert.equal(item('keep-awake').label, '保持屏幕常亮');
  assert.equal(item('settings').label, '设置');
  assert.equal(item('quit').label, '退出 Cairn');
  assert.equal(item('coordinator-status').enabled, false);
  assert.equal(item('coordinator-status').label, 'Coordinator 正在回复');
  assert.equal(item('usage-status').enabled, false);
  assert.match(item('usage-status').label, /13K/iu);
  assert.equal(item('quota-status').enabled, false);
  assert.equal(item('quota-status').label, 'Claude 额度已用完');
  assert.equal(item('no-tasks'), undefined);
  const rows = items.filter((row) => row.id === undefined && row.type !== 'separator');
  assert.deepEqual(
    rows.map((row) => row.enabled === false),
    [true, false, true, false, true, false],
  );
  assert.equal(rows[1].label, 'Review notes');
  assert.match(rows[2].label, /Test Mac.*95%/u);
  assert.match(rows[2].toolTip, /20%.*18 GB/u);
  assert.equal(rows[3].label, 'Queued task · 等待这台执行机空闲');
  for (const row of rows.filter((row) => row.enabled !== false)) row.click();
  item('usage').click();
  assert.deepEqual(calls, [
    ['open', '/app?thread=review'],
    ['open', '/app?thread=queued'],
    ['open', '/app?thread=work'],
    ['open', '/app/usage'],
  ]);
});
