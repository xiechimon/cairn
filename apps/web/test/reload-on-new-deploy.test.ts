import { expect, test, vi } from 'vitest';
import { entryScriptOf, reloadOnNewDeploy } from '../src/stale-build-reload.js';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function harness(options: {
  latest: () => Promise<string | null>;
  visible?: boolean;
  busy?: boolean;
}) {
  const target = new EventTarget();
  const reload = vi.fn();
  const offerReload = vi.fn();
  const ticks: (() => void)[] = [];
  const state = { visible: options.visible ?? true, busy: options.busy ?? false, now: 1_000_000 };
  reloadOnNewDeploy({
    target,
    currentEntry: '/assets/index-OLD.js',
    latestEntry: options.latest,
    visible: () => state.visible,
    busy: () => state.busy,
    reload,
    storage: memoryStorage(),
    now: () => state.now,
    every: (run) => {
      ticks.push(run);
    },
    offerReload,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    state,
    reload,
    offerReload,
    tick: async () => {
      for (const run of ticks) run();
      await settle();
    },
    show: async () => {
      state.visible = true;
      target.dispatchEvent(new Event('visibilitychange'));
      await settle();
    },
  };
}

test('a tab that comes back to the front after a deploy reloads onto the new build', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js', visible: false });
  await tab.show();
  expect(tab.reload).toHaveBeenCalledTimes(1);
  expect(tab.offerReload).not.toHaveBeenCalled();
});

test('a tab in the background reloads as soon as the periodic check sees a deploy', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js', visible: false });
  await tab.tick();
  expect(tab.reload).toHaveBeenCalledTimes(1);
  expect(tab.offerReload).not.toHaveBeenCalled();
});

test('a page the person is looking at never reloads by itself and offers a refresh instead', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js' });
  await tab.tick();
  await tab.tick();
  expect(tab.reload).not.toHaveBeenCalled();
  expect(tab.offerReload).toHaveBeenCalledTimes(2);
});

test('the same build or a failed lookup neither reloads nor offers a refresh', async () => {
  for (const latest of [
    async () => '/assets/index-OLD.js',
    () => Promise.reject(new Error('offline')),
    async () => null,
  ]) {
    const tab = harness({ latest, visible: false });
    await tab.tick();
    await tab.show();
    await tab.tick();
    expect(tab.reload).not.toHaveBeenCalled();
    expect(tab.offerReload).not.toHaveBeenCalled();
  }
});

test('a half-typed draft is never reloaded away, even out of sight', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js', visible: false, busy: true });
  await tab.tick();
  await tab.show();
  expect(tab.reload).not.toHaveBeenCalled();
  expect(tab.offerReload).toHaveBeenCalledTimes(2);
});

test('a tab that keeps seeing another build reloads at most once per guard window', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js', visible: false });
  await tab.tick();
  tab.state.now += 5_000;
  await tab.tick();
  expect(tab.reload).toHaveBeenCalledTimes(1);
  expect(tab.offerReload).toHaveBeenCalledTimes(1);
  tab.state.now += 60_000;
  await tab.tick();
  expect(tab.reload).toHaveBeenCalledTimes(2);
});

test('the entry script is read from the served index page, not from other scripts', () => {
  const html =
    '<head><script src="/boot-skeleton.js"></script><link rel="modulepreload" href="/assets/index-AAA.js"><script type="module" crossorigin src="/assets/index-C2NJl_Vf.js"></script></head>';
  expect(entryScriptOf(html)).toBe('/assets/index-C2NJl_Vf.js');
  expect(entryScriptOf('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
});
