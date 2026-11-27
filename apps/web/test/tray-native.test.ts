import {
  type DesktopTrayState,
  type NativeTrayItem,
  type NativeTrayMenu,
  nativeTrayMenuSchema,
} from '@cairn/shared';
import { expect, test } from 'vitest';
import { EN } from '../src/i18n/en.js';
import type { Locale } from '../src/i18n/locale.js';
import { translate } from '../src/i18n/translate.js';
import type { TrayGroup } from '../src/tray/tray-groups.js';
import { machineReading, trayMenuModel } from '../src/tray/tray-native.js';

const quotaShare = 72;
const NOW = 1_000 * 60 * 60_000;

const t = (locale: Locale) => (key: string, vars?: Record<string, string | number>) =>
  translate(locale, EN, key, vars);

const state = (extra: Partial<DesktopTrayState> = {}): DesktopTrayState =>
  ({ keepAwake: 'system', lidClosedAvailable: true, runner: 'on', ...extra }) as DesktopTrayState;

const groups: TrayGroup[] = [
  {
    key: 'waiting',
    label: '等你',
    rows: [{ key: 'q1', title: '用哪个分支？', glyph: 'attention', at: 1, path: '/app?project=p&chat=1' }],
  },
  {
    key: 'machine:m1',
    label: 'build-box',
    literal: true,
    machine: { kind: 'online', memory: 0.94, cpu: 0.31, load: 3.1, cores: 12, diskGb: 212, strain: ['memory'] },
    rows: [
      {
        key: 'hung',
        title: '审阅发行说明',
        glyph: 'attention',
        at: 2,
        path: '/app/t/3',
        hint: { key: '{n} 分钟无进展', vars: { n: 16 } },
        warn: true,
        tip: { key: '还在运行，但 {n} 分钟没有新输出或工具结果', vars: { n: 16 } },
      },
      { key: 'more', title: '', note: { key: '还有 {n} 个，在 Cairn 里看', vars: { n: 2 } }, glyph: 'ring', at: 0, path: '/app' },
    ],
  },
];

const model = (locale: Locale, extra: Partial<Parameters<typeof trayMenuModel>[0]> = {}): NativeTrayMenu =>
  trayMenuModel({
    groups,
    usage: { tokens: '1.2M', quota: { key: 'Claude 额度 {n}%', vars: { n: quotaShare } } },
    coordinatorBusy: true,
    state: state(),
    userName: '本地用户',
    now: NOW,
    t: t(locale),
    ...extra,
  });

const byId = (menu: NativeTrayMenu, id: string): NativeTrayItem => {
  const item = menu.items.find((candidate) => candidate.id === id);
  if (item === undefined) throw new Error(`no item ${id}`);
  return item;
};

test('the native menu carries the tray content in order and passes the schema main checks', () => {
  const menu = model('zh');
  expect(nativeTrayMenuSchema.parse(menu)).toEqual(menu);
  expect(menu.items.map((item) => item.id)).toEqual([
    'coordinator',
    'waiting',
    'waiting/q1',
    'machine:m1',
    'machine:m1/hung',
    'machine:m1/more',
    'usage-rule',
    'usage',
    'controls-rule',
    'runner',
    'keep-awake-title',
    'keep-awake-screen-on',
    'keep-awake-system',
    'keep-awake-lid-closed',
    'settings',
    'account-rule',
    'user',
    'quit',
  ]);
  expect(byId(menu, 'coordinator')).toMatchObject({ status: '正在回复', open: { kind: 'path', path: '/app' } });
  expect(byId(menu, 'machine:m1')).toEqual({
    kind: 'header',
    id: 'machine:m1',
    title: 'build-box',
    reading: {
      parts: [
        { text: '内存 94%', strained: true },
        { text: 'CPU 31%', strained: false },
        { text: '负载 3.1 / 12 核', strained: false },
      ],
      faint: false,
      spoken: '内存吃紧, 内存 94%, CPU 31%, 负载 3.1 / 12 核',
      tip: '内存压力 94%；CPU 31%；负载 3.1 / 12 核；剩余磁盘 212 GB',
    },
  });
  expect(byId(menu, 'waiting')).not.toHaveProperty('reading');
  expect(byId(menu, 'machine:m1/hung')).toMatchObject({
    title: '审阅发行说明',
    glyph: 'attention',
    status: '16 分钟无进展',
    warn: true,
    tip: '还在运行，但 16 分钟没有新输出或工具结果',
    open: { kind: 'path', path: '/app/t/3' },
  });
  expect(byId(menu, 'machine:m1/more')).toEqual({
    kind: 'row',
    id: 'machine:m1/more',
    title: '还有 2 个，在 Cairn 里看',
    open: { kind: 'path', path: '/app' },
  });
  expect(byId(menu, 'usage')).toMatchObject({ title: '今天用了 1.2M tokens', status: `Claude 额度 ${quotaShare}%` });
  expect(byId(menu, 'user')).toEqual({ kind: 'row', id: 'user', title: '本地用户', image: 'user' });
  expect(byId(menu, 'settings')).toMatchObject({ title: '设置', key: ',' });
  expect(byId(menu, 'quit')).toMatchObject({ title: '退出 Cairn', key: 'q' });
});

test('the menu speaks the app language through the same t() strings', () => {
  const menu = model('en');
  expect(byId(menu, 'coordinator')).toMatchObject({ status: 'Replying' });
  expect(byId(menu, 'runner')).toMatchObject({ title: 'Runner', detail: 'Running' });
  expect(byId(menu, 'keep-awake-title')).toMatchObject({ title: 'Stay awake while tasks run' });
  expect(byId(menu, 'keep-awake-screen-on')).toMatchObject({ title: 'Keep the screen on' });
  expect(byId(menu, 'keep-awake-system')).toMatchObject({ title: 'Let the screen sleep' });
  expect(byId(menu, 'keep-awake-lid-closed')).toMatchObject({ title: 'Keep running with the lid closed' });
  expect(byId(menu, 'settings')).toMatchObject({ title: 'Settings' });
  expect(byId(menu, 'quit')).toMatchObject({ title: 'Quit Cairn' });
  expect(byId(menu, 'usage')).toMatchObject({ title: 'Used today: 1.2M' });
  expect(byId(menu, 'waiting')).toMatchObject({ title: EN['等你'] ?? '等你' });
  expect(byId(menu, 'machine:m1')).toMatchObject({
    title: 'build-box',
    reading: { parts: [{ text: 'Memory 94%' }, { text: 'CPU 31%' }, { text: 'Load 3.1 / 12 cores' }] },
  });
});

test('every computer reads its memory and load, including idle, strained, offline and unreported ones', () => {
  const reading = (state: Parameters<typeof machineReading>[0], locale: Locale = 'zh') =>
    machineReading(state, NOW, t(locale));
  const online = { kind: 'online', memory: 0.42, cpu: 0.31, load: 3.1, cores: 12, diskGb: 212, strain: [] } as const;
  expect(reading(online).parts.map((part) => part.text)).toEqual(['内存 42%', 'CPU 31%', '负载 3.1 / 12 核']);
  expect(reading(online).parts.every((part) => !part.strained)).toBe(true);
  expect(reading({ ...online, cpu: 0.97, strain: ['cpu'] }).parts[1]).toEqual({ text: 'CPU 97%', strained: true });
  expect(reading({ ...online, diskGb: 3, strain: ['disk'] }, 'en')).toMatchObject({
    parts: [
      { text: 'Memory 42%', strained: false },
      { text: 'CPU 31%', strained: false },
      { text: 'Load 3.1 / 12 cores', strained: false },
      { text: '3 GB disk free', strained: true },
    ],
    spoken: 'Disk almost full, Memory 42%, CPU 31%, Load 3.1 / 12 cores, 3 GB disk free',
  });
  expect(reading({ ...online, cpu: null }).parts.map((part) => part.text)).toEqual(['内存 42%', '负载 3.1 / 12 核']);
  expect(reading({ kind: 'offline', lastSeenAt: NOW - 2 * 24 * 60 * 60_000 })).toEqual({
    parts: [{ text: '离线 · 最后在线 2 天前', strained: false }],
    faint: true,
    spoken: '离线 · 最后在线 2 天前',
    tip: '离线时读数已过期，不显示',
  });
  expect(reading({ kind: 'offline', lastSeenAt: NOW - 2 * 60 * 60_000 }, 'en').parts[0]?.text).toBe(
    'Offline · Last seen 2h ago',
  );
  expect(reading({ kind: 'offline', lastSeenAt: null }).parts[0]?.text).toBe('离线');
  expect(reading({ kind: 'unreported' }, 'en')).toMatchObject({
    parts: [{ text: 'No memory or load reported yet', strained: false }],
    faint: true,
  });
});

test('idle computers stay listed under the empty line', () => {
  const idle: TrayGroup = {
    key: 'machine:m9',
    label: 'Mac mini',
    literal: true,
    machine: { kind: 'unreported' },
    rows: [],
  };
  const menu = model('zh', { groups: [idle], usage: null });
  expect(menu.items.slice(0, 3).map((item) => item.id)).toEqual(['coordinator', 'empty', 'machine:m9']);
  expect(nativeTrayMenuSchema.parse(menu)).toEqual(menu);
});

test('with nothing waiting and no usage the menu says so and keeps the controls', () => {
  const menu = model('zh', { groups: [], usage: null, coordinatorBusy: false });
  expect(menu.items.map((item) => item.id)).toEqual([
    'coordinator',
    'empty',
    'controls-rule',
    'runner',
    'keep-awake-title',
    'keep-awake-screen-on',
    'keep-awake-system',
    'keep-awake-lid-closed',
    'settings',
    'account-rule',
    'user',
    'quit',
  ]);
  expect(byId(menu, 'coordinator')).not.toHaveProperty('status');
  expect(byId(menu, 'empty')).toEqual({ kind: 'row', id: 'empty', title: '没有等你的事' });
});

test('the Runner switch follows every Runner state, and nothing toggles before main reports', () => {
  const runner = (extra: Parameters<typeof trayMenuModel>[0]['state']) => byId(model('zh', { state: extra }), 'runner');
  expect(runner(state({ runner: 'on' }))).toMatchObject({ detail: '运行中', on: true, enabled: true });
  expect(runner(state({ runner: 'off' }))).toMatchObject({ detail: '已关闭', on: false, enabled: true });
  expect(runner(state({ runner: 'starting' }))).toMatchObject({ detail: '正在启动', on: true, enabled: false });
  expect(runner(state({ runner: 'failed' }))).toMatchObject({ detail: '已停止', on: false, enabled: true, warn: true });
  expect(runner(null)).toMatchObject({ enabled: false });
  for (const id of ['keep-awake-screen-on', 'keep-awake-system']) {
    expect(byId(model('zh', { state: null }), id)).toMatchObject({ on: false, enabled: false });
  }
  expect(byId(model('zh', { state: state({ keepAwake: 'screen-on' }) }), 'keep-awake-screen-on')).toMatchObject({ on: true, enabled: true });
  expect(byId(model('zh', { state: state({ keepAwake: 'screen-on' }) }), 'keep-awake-system')).toMatchObject({ on: false, enabled: true });
});

test('battery hides lid-closed and checks the effective system fallback', () => {
  const menu = model('zh', {
    state: state({ keepAwake: 'lid-closed', lidClosedAvailable: false }),
  });
  expect(menu.items.some((item) => item.id === 'keep-awake-lid-closed')).toBe(false);
  expect(byId(menu, 'keep-awake-system')).toMatchObject({ on: true, enabled: true });
  expect(byId(menu, 'keep-awake-screen-on')).toMatchObject({ on: false, enabled: true });
  expect(nativeTrayMenuSchema.parse(menu)).toEqual(menu);
});

test('power-state publish updates checked and available rows', () => {
  const onBattery = model('zh', {
    state: state({ keepAwake: 'lid-closed', lidClosedAvailable: false }),
  });
  const onAc = model('zh', {
    state: state({ keepAwake: 'lid-closed', lidClosedAvailable: true }),
  });
  expect(byId(onBattery, 'keep-awake-system')).toMatchObject({ on: true });
  expect(byId(onAc, 'keep-awake-system')).toMatchObject({ on: false });
  expect(byId(onAc, 'keep-awake-lid-closed')).toMatchObject({ on: true, enabled: true });
});

test('main refuses a menu that names an unknown switch or a path outside the app', () => {
  const menu = model('zh');
  const unknownSwitch = { ...menu, items: [{ kind: 'switch', id: 'shell', title: 'x', on: true, enabled: true }] };
  expect(nativeTrayMenuSchema.safeParse(unknownSwitch).success).toBe(false);
  const outside = {
    ...menu,
    items: [{ kind: 'row', id: 'x', title: 'x', open: { kind: 'path', path: 'https://example.com' } }],
  };
  expect(nativeTrayMenuSchema.safeParse(outside).success).toBe(false);
});
