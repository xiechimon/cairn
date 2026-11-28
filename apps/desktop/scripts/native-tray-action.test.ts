import { readFileSync } from 'node:fs';
import {
  type NativeTrayItem,
  nativeTrayMenuSchema,
  parseNativeTrayMenu,
} from '@cairn/shared/desktop-shell';
import { describe, expect, test } from 'vitest';
import {
  createNativeTrayMenuReceiver,
  nativeMenuWithHostState,
  nativeTrayAction,
  skeletonTrayMenu,
  withHostState,
} from '../src/native-tray.js';

const itemById = (menu: ReturnType<typeof skeletonTrayMenu>, id: string) =>
  menu.items
    .flatMap<NativeTrayItem>((item) =>
      item.kind === 'disclosure' ? [item, ...item.children] : [item],
    )
    .find((item) => item.id === id);

describe('native keep-awake mode rows', () => {
  test('skeleton mode rows map to mode actions', () => {
    for (const locale of ['zh', 'en'] as const) {
      const menu = skeletonTrayMenu(locale);
      for (const [id, mode] of [
        ['keep-awake-screen-on', 'screen-on'],
        ['keep-awake-system', 'system'],
        ['keep-awake-lid-closed', 'lid-closed'],
      ] as const) {
        expect(nativeTrayAction(menu, id)).toEqual({ kind: 'keep-awake', mode });
      }
      expect(nativeTrayAction(menu, 'keep-awake')).toBeNull();
    }
  });

  test('host state checks the effective fallback and hides lid-closed on battery', () => {
    const menu = withHostState(skeletonTrayMenu('zh'), {
      keepAwake: 'lid-closed',
      lidClosedAvailable: false,
      runner: 'on',
    });
    expect(itemById(menu, 'keep-awake-lid-closed')).toMatchObject({ enabled: false });
    expect(itemById(menu, 'keep-awake-system')).toMatchObject({ on: true });
    expect(itemById(menu, 'keep-awake-screen-on')).toMatchObject({
      on: false,
    });
  });

  test('host state restores the stored lid-closed selection on AC', () => {
    const menu = withHostState(skeletonTrayMenu('zh'), {
      keepAwake: 'lid-closed',
      lidClosedAvailable: true,
      runner: 'on',
    });
    expect(itemById(menu, 'keep-awake-lid-closed')).toMatchObject({
      on: true,
    });
    expect(itemById(menu, 'keep-awake-system')).toMatchObject({
      on: false,
    });
  });

  test('the no-page-menu fallback restores lid-closed when power returns', () => {
    const battery = nativeMenuWithHostState(null, 'zh', {
      keepAwake: 'lid-closed',
      lidClosedAvailable: false,
      runner: 'on',
    });
    expect(itemById(battery, 'keep-awake-lid-closed')).toMatchObject({ enabled: false });
    const ac = nativeMenuWithHostState(null, 'zh', {
      keepAwake: 'lid-closed',
      lidClosedAvailable: true,
      runner: 'on',
    });
    expect(itemById(ac, 'keep-awake-lid-closed')).toMatchObject({
      on: true,
    });
  });

  test('native mode actions name the exact clicked mode', () => {
    const menu = skeletonTrayMenu('en');
    expect(nativeTrayAction(menu, 'keep-awake-screen-on')).toEqual({
      kind: 'keep-awake',
      mode: 'screen-on',
    });
    expect(nativeTrayAction(menu, 'keep-awake-system')).toEqual({
      kind: 'keep-awake',
      mode: 'system',
    });
    expect(nativeTrayAction(menu, 'keep-awake-lid-closed')).toEqual({
      kind: 'keep-awake',
      mode: 'lid-closed',
    });
  });

  test('skeleton menus and Swift fixture menu conform to the shared schema', () => {
    for (const locale of ['zh', 'en'] as const) {
      const skeleton = skeletonTrayMenu(locale);
      expect(nativeTrayMenuSchema.parse(skeleton)).toEqual(skeleton);
    }
    const fixtureRaw = readFileSync(
      new URL('../native/tray/test/fixture-menu.json', import.meta.url),
      'utf8',
    );
    const fixture = JSON.parse(fixtureRaw) as { menu: unknown };
    expect(nativeTrayMenuSchema.parse(fixture.menu)).toEqual(fixture.menu);
  });

  test('parseNativeTrayMenu preserves valid controls when skewed or unknown items appear, while rejecting unsafe or empty menus', () => {
    const valid = skeletonTrayMenu('zh');
    expect(parseNativeTrayMenu(valid)).toEqual({ ok: true, menu: valid, dropped: [] });

    const skewed = {
      label: 'Cairn',
      items: [
        {
          kind: 'row',
          id: 'coordinator',
          title: 'Coordinator',
          open: { kind: 'path', path: '/app' },
        },
        { kind: 'switch', id: 'runner', title: '本机执行机', on: true, enabled: true },
        { kind: 'switch', id: 'keep-awake', title: '保持屏幕常亮', on: false, enabled: true },
        { kind: 'banner', id: 'future-banner', title: 'Future item' },
        {
          kind: 'row',
          id: 'unsafe',
          title: 'Bad',
          open: { kind: 'path', path: 'https://example.com' },
        },
        { kind: 'switch', id: 'shell', title: 'Bad switch', on: true, enabled: true },
        { kind: 'command', id: 'settings', title: '设置', key: ',' },
        { kind: 'command', id: 'quit', title: '退出 Cairn', key: 'q' },
      ],
    };
    const parsed = parseNativeTrayMenu(skewed);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('expected skew-tolerant parse');
    expect(parsed.menu.items.map((item) => item.id)).toEqual([
      'coordinator',
      'runner',
      'settings',
      'quit',
    ]);
    expect(parsed.dropped.length).toBe(4);

    const withRestoredModes = withHostState(
      parsed.menu,
      { keepAwake: 'screen-on', lidClosedAvailable: true, runner: 'on' },
      'zh',
    );
    expect(withRestoredModes.items.map((item) => item.id)).toEqual([
      'coordinator',
      'runner',
      'keep-awake',
      'settings',
      'quit',
    ]);
    expect(itemById(withRestoredModes, 'keep-awake-screen-on')).toMatchObject({ on: true });

    const allBad = {
      label: 'Cairn',
      items: [{ kind: 'banner', id: 'future', title: 'Nope' }],
    };
    expect(parseNativeTrayMenu(allBad).ok).toBe(false);
    expect(parseNativeTrayMenu({ label: 123, items: [] }).ok).toBe(false);
  });

  test('createNativeTrayMenuReceiver logs identical schema issues once and resets after a clean menu', () => {
    const logs: string[] = [];
    const receive = createNativeTrayMenuReceiver((line) => logs.push(line));
    const partial = {
      label: 'Cairn',
      items: [
        { kind: 'switch', id: 'runner', title: 'Runner', on: true, enabled: true },
        { kind: 'switch', id: 'keep-awake', title: 'Keep awake', on: false, enabled: true },
      ],
    };
    expect(receive(partial)?.items.map((item) => item.id)).toEqual(['runner']);
    expect(receive(partial)?.items.map((item) => item.id)).toEqual(['runner']);
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('keep-awake');

    expect(receive(skeletonTrayMenu('en'))).not.toBeNull();
    expect(receive(partial)?.items.map((item) => item.id)).toEqual(['runner']);
    expect(logs.length).toBe(2);

    expect(receive({ label: 'Cairn', items: [{ kind: 'banner', id: 'x' }] })).toBeNull();
    expect(receive({ label: 'Cairn', items: [{ kind: 'banner', id: 'x' }] })).toBeNull();
    expect(logs.length).toBe(3);
  });
});

test('flat legacy choice rows stay actionable before the host upgrades them', () => {
  const flat = {
    label: 'Cairn',
    items: [
      {
        kind: 'choice' as const,
        id: 'keep-awake-screen-on' as const,
        title: 'Screen on',
        on: true,
        enabled: true,
      },
      {
        kind: 'choice' as const,
        id: 'keep-awake-system' as const,
        title: 'System',
        on: false,
        enabled: false,
      },
    ],
  };
  expect(nativeTrayAction(flat, 'keep-awake-screen-on')).toEqual({
    kind: 'keep-awake',
    mode: 'screen-on',
  });
  expect(nativeTrayAction(flat, 'keep-awake-system')).toBeNull();
});

test('host upgrades missing legacy lid choice and rejects disabled actions', () => {
  const legacy = {
    label: 'Cairn',
    items: [
      { kind: 'header' as const, id: 'keep-awake-title', title: 'Help' },
      {
        kind: 'choice' as const,
        id: 'keep-awake-system' as const,
        title: 'System',
        on: true,
        enabled: true,
      },
    ],
  };
  const menu = withHostState(
    legacy,
    { keepAwake: 'lid-closed', lidClosedAvailable: false, runner: 'off' },
    'zh',
  );
  expect(menu.items.find((item) => item.id === 'keep-awake')).toMatchObject({
    kind: 'disclosure',
    children: [{}, { title: 'System', on: true }, { enabled: false, tip: '需要接通电源' }],
  });
  expect(nativeTrayAction(menu, 'keep-awake-lid-closed')).toBeNull();
  expect(nativeTrayAction(menu, 'keep-awake-system')).toEqual({
    kind: 'keep-awake',
    mode: 'system',
  });
});
