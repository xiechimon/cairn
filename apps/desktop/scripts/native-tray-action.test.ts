import { describe, expect, test } from 'vitest';
import {
  nativeMenuWithHostState,
  nativeTrayAction,
  skeletonTrayMenu,
  withHostState,
} from '../src/native-tray.js';

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
    expect(menu.items.some((item) => item.id === 'keep-awake-lid-closed')).toBe(false);
    expect(menu.items.find((item) => item.id === 'keep-awake-system')).toMatchObject({ on: true });
    expect(menu.items.find((item) => item.id === 'keep-awake-screen-on')).toMatchObject({
      on: false,
    });
  });

  test('host state restores the stored lid-closed selection on AC', () => {
    const menu = withHostState(skeletonTrayMenu('zh'), {
      keepAwake: 'lid-closed',
      lidClosedAvailable: true,
      runner: 'on',
    });
    expect(menu.items.find((item) => item.id === 'keep-awake-lid-closed')).toMatchObject({
      on: true,
    });
    expect(menu.items.find((item) => item.id === 'keep-awake-system')).toMatchObject({
      on: false,
    });
  });

  test('the no-page-menu fallback restores lid-closed when power returns', () => {
    const battery = nativeMenuWithHostState(null, 'zh', {
      keepAwake: 'lid-closed',
      lidClosedAvailable: false,
      runner: 'on',
    });
    expect(battery.items.some((item) => item.id === 'keep-awake-lid-closed')).toBe(false);
    const ac = nativeMenuWithHostState(null, 'zh', {
      keepAwake: 'lid-closed',
      lidClosedAvailable: true,
      runner: 'on',
    });
    expect(ac.items.find((item) => item.id === 'keep-awake-lid-closed')).toMatchObject({
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
});
