import { expect, test, vi } from 'vitest';
import { reloadOnStaleBuild } from '../src/stale-build-reload.js';

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

function preloadError(): Event {
  return new Event('vite:preloadError', { cancelable: true });
}

test('a chunk from an older build flushes drafts, reloads the page once, and swallows the error', () => {
  const target = new EventTarget();
  const order: string[] = [];
  const reload = vi.fn(() => order.push('reload'));
  const prepareReload = vi.fn(() => order.push('prepare'));
  reloadOnStaleBuild({
    target,
    storage: memoryStorage(),
    reload,
    prepareReload,
    now: () => 1_000_000,
  });
  const event = preloadError();
  target.dispatchEvent(event);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(prepareReload).toHaveBeenCalledTimes(1);
  expect(order).toEqual(['prepare', 'reload']);
  expect(event.defaultPrevented).toBe(true);
});

test('a second failure right after the reload lets the error through instead of looping', () => {
  const target = new EventTarget();
  const storage = memoryStorage();
  const reload = vi.fn();
  let now = 1_000_000;
  reloadOnStaleBuild({ target, storage, reload, now: () => now });
  target.dispatchEvent(preloadError());
  now += 5_000;
  const again = preloadError();
  target.dispatchEvent(again);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(again.defaultPrevented).toBe(false);
  now += 60_000;
  target.dispatchEvent(preloadError());
  expect(reload).toHaveBeenCalledTimes(2);
});

test('without session storage it never reloads, so it cannot loop', () => {
  const target = new EventTarget();
  const reload = vi.fn();
  reloadOnStaleBuild({ target, storage: null, reload, now: () => 1_000_000 });
  const event = preloadError();
  target.dispatchEvent(event);
  expect(reload).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});

test('does not reload when vite:preloadError fires while the server is unreachable', async () => {
  const target = new EventTarget();
  const reload = vi.fn();
  const prepareReload = vi.fn();
  const isServerReachable = vi.fn(async () => false);
  reloadOnStaleBuild({
    target,
    storage: memoryStorage(),
    reload,
    prepareReload,
    isServerReachable,
    now: () => 1_000_000,
  });

  const event = preloadError();
  target.dispatchEvent(event);
  await Promise.resolve();
  await Promise.resolve();

  expect(isServerReachable).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();
  expect(prepareReload).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});

test('reloads once when vite:preloadError fires and the server is reachable', async () => {
  const target = new EventTarget();
  const reload = vi.fn();
  const prepareReload = vi.fn();
  const isServerReachable = vi.fn(async () => true);
  reloadOnStaleBuild({
    target,
    storage: memoryStorage(),
    reload,
    prepareReload,
    isServerReachable,
    now: () => 1_000_000,
  });

  target.dispatchEvent(preloadError());
  await Promise.resolve();
  await Promise.resolve();

  expect(isServerReachable).toHaveBeenCalledTimes(1);
  expect(prepareReload).toHaveBeenCalledTimes(1);
  expect(reload).toHaveBeenCalledTimes(1);
});
