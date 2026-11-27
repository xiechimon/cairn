import { afterEach, expect, test, vi } from 'vitest';
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
  skipNav?: boolean;
  idleMs?: number;
}) {
  const target = new EventTarget();
  const windowTarget = new EventTarget();
  const activityTarget = new EventTarget();
  const reload = vi.fn();
  const prepareReload = vi.fn();
  const ticks: (() => void)[] = [];
  const navListeners = new Set<() => void>();
  const timers = new Map<number, { run: () => void; at: number }>();
  let nextTimerId = 1;
  const state = {
    visible: options.visible ?? true,
    busy: options.busy ?? false,
    skipNav: options.skipNav ?? false,
    now: 1_000_000,
  };
  const dispose = reloadOnNewDeploy({
    target,
    windowTarget,
    activityTarget,
    currentEntry: '/assets/index-OLD.js',
    latestEntry: options.latest,
    visible: () => state.visible,
    busy: () => state.busy,
    reload,
    prepareReload,
    storage: memoryStorage(),
    now: () => state.now,
    every: (run) => {
      ticks.push(run);
    },
    subscribeNavigation: (onNavigate) => {
      navListeners.add(onNavigate);
      return () => {
        navListeners.delete(onNavigate);
      };
    },
    shouldSkipNavigationReload: () => state.skipNav,
    idleMs: options.idleMs ?? 15_000,
    setTimer: (run, ms) => {
      const id = nextTimerId++;
      timers.set(id, { run, at: state.now + ms });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (id) => {
      timers.delete(id as unknown as number);
    },
  });
  const settle = () => Promise.resolve().then(() => Promise.resolve());
  const advanceTimers = async (ms: number) => {
    const end = state.now + ms;
    while (true) {
      let dueId: number | null = null;
      let dueEntry: { run: () => void; at: number } | null = null;
      for (const [id, entry] of timers) {
        if (entry.at <= end && (dueEntry === null || entry.at < dueEntry.at)) {
          dueId = id;
          dueEntry = entry;
        }
      }
      if (dueId === null || dueEntry === null) break;
      timers.delete(dueId);
      state.now = Math.max(state.now, dueEntry.at);
      dueEntry.run();
      await settle();
    }
    state.now = end;
  };
  return {
    state,
    reload,
    prepareReload,
    dispose,
    tick: async () => {
      for (const run of ticks) run();
      await settle();
    },
    show: async () => {
      state.visible = true;
      target.dispatchEvent(new Event('visibilitychange'));
      await settle();
    },
    hide: async () => {
      state.visible = false;
      target.dispatchEvent(new Event('visibilitychange'));
      await settle();
    },
    blur: async () => {
      windowTarget.dispatchEvent(new Event('blur'));
      await settle();
    },
    activity: (type = 'keydown') => {
      activityTarget.dispatchEvent(new Event(type));
    },
    navigate: async () => {
      for (const listener of navListeners) listener();
      await advanceTimers(0);
    },
    advanceTimers,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test('a tab that comes back to the front after a deploy flushes drafts and reloads onto the new build', async () => {
  const order: string[] = [];
  const tab = harness({ latest: async () => '/assets/index-NEW.js', visible: false });
  tab.prepareReload.mockImplementation(() => order.push('prepare'));
  tab.reload.mockImplementation(() => order.push('reload'));
  await tab.show();
  expect(tab.reload).toHaveBeenCalledTimes(1);
  expect(tab.prepareReload).toHaveBeenCalledTimes(1);
  expect(order).toEqual(['prepare', 'reload']);
  tab.dispose();
});

test('a tab in the background reloads as soon as the periodic check sees a deploy', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js', visible: false });
  await tab.tick();
  expect(tab.reload).toHaveBeenCalledTimes(1);
  expect(tab.prepareReload).toHaveBeenCalledTimes(1);
  tab.dispose();
});

test('a visible page defers reload when a deploy lands, then silently reloads on hide or blur', async () => {
  const visibleHide = harness({ latest: async () => '/assets/index-NEW.js', visible: true });
  await visibleHide.tick();
  expect(visibleHide.reload).not.toHaveBeenCalled();
  await visibleHide.hide();
  expect(visibleHide.reload).toHaveBeenCalledTimes(1);
  expect(visibleHide.prepareReload).toHaveBeenCalledTimes(1);
  visibleHide.dispose();

  const visibleBlur = harness({ latest: async () => '/assets/index-NEW.js', visible: true });
  await visibleBlur.tick();
  expect(visibleBlur.reload).not.toHaveBeenCalled();
  await visibleBlur.blur();
  expect(visibleBlur.reload).toHaveBeenCalledTimes(1);
  expect(visibleBlur.prepareReload).toHaveBeenCalledTimes(1);
  visibleBlur.dispose();
});

test('an idle visible page silently reloads after idleMs and resets the timer on user activity', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js', visible: true, idleMs: 15_000 });
  await tab.tick();
  expect(tab.reload).not.toHaveBeenCalled();
  await tab.advanceTimers(10_000);
  expect(tab.reload).not.toHaveBeenCalled();
  tab.activity('input');
  await tab.advanceTimers(10_000);
  expect(tab.reload).not.toHaveBeenCalled();
  await tab.advanceTimers(5_000);
  expect(tab.reload).toHaveBeenCalledTimes(1);
  expect(tab.prepareReload).toHaveBeenCalledTimes(1);
  tab.dispose();
});

test('a clean route navigation reloads onto the new build unless skipped', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js', visible: true });
  await tab.tick();
  expect(tab.reload).not.toHaveBeenCalled();
  tab.state.skipNav = true;
  await tab.navigate();
  expect(tab.reload).not.toHaveBeenCalled();
  tab.state.skipNav = false;
  await tab.navigate();
  expect(tab.reload).toHaveBeenCalledTimes(1);
  expect(tab.prepareReload).toHaveBeenCalledTimes(1);
  tab.dispose();
});

test('the same build or a failed lookup never reloads or flushes drafts', async () => {
  for (const latest of [
    async () => '/assets/index-OLD.js',
    () => Promise.reject(new Error('offline')),
    async () => null,
  ]) {
    const tab = harness({ latest, visible: false });
    await tab.tick();
    await tab.show();
    await tab.blur();
    await tab.navigate();
    await tab.advanceTimers(20_000);
    expect(tab.reload).not.toHaveBeenCalled();
    expect(tab.prepareReload).not.toHaveBeenCalled();
    tab.dispose();
  }
});

test('a busy session never reloads away until busy clears', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js', visible: false, busy: true });
  await tab.tick();
  await tab.show();
  await tab.blur();
  await tab.hide();
  await tab.advanceTimers(20_000);
  expect(tab.reload).not.toHaveBeenCalled();
  expect(tab.prepareReload).not.toHaveBeenCalled();

  tab.state.busy = false;
  await tab.blur();
  expect(tab.reload).toHaveBeenCalledTimes(1);
  expect(tab.prepareReload).toHaveBeenCalledTimes(1);
  tab.dispose();
});

test('a tab that keeps seeing another build reloads at most once per guard window', async () => {
  const tab = harness({ latest: async () => '/assets/index-NEW.js', visible: false });
  await tab.tick();
  tab.state.now += 5_000;
  await tab.tick();
  expect(tab.reload).toHaveBeenCalledTimes(1);
  expect(tab.prepareReload).toHaveBeenCalledTimes(1);
  tab.state.now += 60_000;
  await tab.tick();
  expect(tab.reload).toHaveBeenCalledTimes(2);
  expect(tab.prepareReload).toHaveBeenCalledTimes(2);
  tab.dispose();
});

test('the entry script is read from the served index page, not from other scripts', () => {
  const html =
    '<head><script src="/boot-skeleton.js"></script><link rel="modulepreload" href="/assets/index-AAA.js"><script type="module" crossorigin src="/assets/index-C2NJl_Vf.js"></script></head>';
  expect(entryScriptOf(html)).toBe('/assets/index-C2NJl_Vf.js');
  expect(entryScriptOf('<SCRIPT TYPE="module" SRC="/assets/index-UPPER.js"></SCRIPT>')).toBe(
    '/assets/index-UPPER.js',
  );
  expect(entryScriptOf('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
});
