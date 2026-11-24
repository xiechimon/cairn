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
import { trayMenuModel } from '../src/tray/tray-native.js';

const quotaShare = 72;

const t = (locale: Locale) => (key: string, vars?: Record<string, string | number>) =>
  translate(locale, EN, key, vars);

const state = (extra: Partial<DesktopTrayState> = {}): DesktopTrayState =>
  ({ keepAwake: false, runner: 'on', ...extra }) as DesktopTrayState;

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
    os: { osPlatform: 'linux', osDistribution: 'arch' },
    meta: {
      percent: 94,
      level: 'full',
      warn: true,
      tip: { key: '内存压力 {n}%', vars: { n: 94 } },
    },
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
    'keep-awake',
    'settings',
    'account-rule',
    'user',
    'quit',
  ]);
  expect(byId(menu, 'coordinator')).toMatchObject({ status: '正在回复', open: { kind: 'path', path: '/app' } });
  expect(byId(menu, 'machine:m1')).toMatchObject({
    kind: 'header',
    title: 'build-box',
    os: 'linux',
    meter: { percent: 94, level: 'full', tip: '内存压力 94%' },
  });
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
  expect(byId(menu, 'keep-awake')).toMatchObject({ title: 'Keep the screen on' });
  expect(byId(menu, 'settings')).toMatchObject({ title: 'Settings' });
  expect(byId(menu, 'quit')).toMatchObject({ title: 'Quit Cairn' });
  expect(byId(menu, 'usage')).toMatchObject({ title: 'Used today: 1.2M' });
  expect(byId(menu, 'waiting')).toMatchObject({ title: EN['等你'] ?? '等你' });
  expect(byId(menu, 'machine:m1')).toMatchObject({ title: 'build-box' });
});

test('with nothing waiting and no usage the menu says so and keeps the controls', () => {
  const menu = model('zh', { groups: [], usage: null, coordinatorBusy: false });
  expect(menu.items.map((item) => item.id)).toEqual([
    'coordinator',
    'empty',
    'controls-rule',
    'runner',
    'keep-awake',
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
  expect(byId(model('zh', { state: null }), 'keep-awake')).toMatchObject({ on: false, enabled: false });
  expect(byId(model('zh', { state: state({ keepAwake: true }) }), 'keep-awake')).toMatchObject({ on: true, enabled: true });
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
