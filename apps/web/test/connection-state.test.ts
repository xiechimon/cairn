import { describe, expect, it, vi } from 'vitest';
import { createConnectionStore } from '../src/api/connection-state.js';

function fakeWindow(onLine: boolean) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    navigator: { onLine },
    addEventListener: (type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    fire(type: string, next: boolean) {
      this.navigator.onLine = next;
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };
}

describe('connection store', () => {
  it('reads the initial state from navigator.onLine', () => {
    expect(createConnectionStore(fakeWindow(false)).getSnapshot()).toBe(false);
    expect(createConnectionStore(fakeWindow(true)).getSnapshot()).toBe(true);
  });

  it('notifies on offline and online events and reports the new state', () => {
    const win = fakeWindow(true);
    const store = createConnectionStore(win);
    const seen: boolean[] = [];
    const stop = store.subscribe(() => seen.push(store.getSnapshot()));
    win.fire('offline', false);
    win.fire('online', true);
    expect(seen).toEqual([false, true]);
    stop();
    win.fire('offline', false);
    expect(seen).toEqual([false, true]);
  });

  it('assumes connected when there is no window', () => {
    expect(createConnectionStore(undefined).getSnapshot()).toBe(true);
    const cb = vi.fn();
    createConnectionStore(undefined).subscribe(cb)();
    expect(cb).not.toHaveBeenCalled();
  });
});
