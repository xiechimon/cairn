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

function harness(options: { latest: () => Promise<string | null>; visible?: boolean; busy?: boolean }) {
  const target = new EventTarget();
  const reload = vi.fn();
  const ticks: (() => void)[] = [];
  const state = { visible: options.visible ?? true, busy: options.busy ?? false, now: 1_000_000 };
  const latestEntry = vi.fn(options.latest);
  reloadOnNewDeploy({
    target,
    currentEntry: '/assets/index-OLD.js',
    latestEntry,
    visible: () => state.visible,
    busy: () => state.busy,
    reload,
    storage: memoryStorage(),
    now: () => state.now,
    every: (run) => {
      ticks.push(run);
    },
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    state,
    reload,
    latestEntry,
    tick: async () => {
      for (const run of ticks) run();
      await settle();
    },
    show: async () => {
      state.visible = true;
      target.dispatchEvent(new Event('visibilitychange'));
      await settle();
    },
    blur: async () => {
      target.dispatchEvent(new Event('focusout'));
      await settle();
    },
  };
}

test('a tab that comes back to the front after a deploy reloads onto the new build', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js', visible: false });
  await tab.show();
  expect(tab.reload).toHaveBeenCalledTimes(1);
});

test('a visible tab picks up a deploy on the periodic check without any user action', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js' });
  await tab.tick();
  expect(tab.reload).toHaveBeenCalledTimes(1);
});

test('the same build, a failed lookup or a hidden tab never reloads', async () => {
  const same = harness({ latest: async () => '/assets/index-OLD.js' });
  await same.tick();
  await same.show();
  expect(same.reload).not.toHaveBeenCalled();

  const offline = harness({ latest: () => Promise.reject(new Error('offline')) });
  await offline.tick();
  expect(offline.reload).not.toHaveBeenCalled();

  const hidden = harness({ latest: async () => '/assets/index-NEW.js', visible: false });
  await hidden.tick();
  expect(hidden.latestEntry).not.toHaveBeenCalled();
  expect(hidden.reload).not.toHaveBeenCalled();
});

test('while the person is typing it waits and reloads once the field loses focus', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js', busy: true });
  await tab.tick();
  expect(tab.reload).not.toHaveBeenCalled();
  await tab.blur();
  expect(tab.reload).not.toHaveBeenCalled();
  tab.state.busy = false;
  await tab.blur();
  expect(tab.reload).toHaveBeenCalledTimes(1);
});

test('a page that keeps seeing another build reloads at most once per guard window', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js' });
  await tab.tick();
  tab.state.now += 5_000;
  await tab.tick();
  expect(tab.reload).toHaveBeenCalledTimes(1);
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
