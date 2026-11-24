import { useSyncExternalStore } from 'react';

interface OnlineWindow {
  addEventListener: (type: 'online', listener: () => void) => void;
  removeEventListener: (type: 'online', listener: () => void) => void;
}

export interface StreamConnectionHandle {
  setConnected: (connected: boolean) => void;
  detach: () => void;
}

export function createConnectionStore(win: OnlineWindow | undefined) {
  const streams = new Map<symbol, boolean>();
  const listeners = new Set<() => void>();
  const onlineListeners = new Set<() => void>();
  let snapshot = true;

  const notify = (): void => {
    const next = [...streams.values()].every(Boolean);
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const handleOnline = (): void => {
    for (const listener of onlineListeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach: (): StreamConnectionHandle => {
      const id = Symbol();
      streams.set(id, true);
      return {
        setConnected: (connected: boolean) => {
          if (!streams.has(id) || streams.get(id) === connected) return;
          streams.set(id, connected);
          notify();
        },
        detach: () => {
          if (!streams.delete(id)) return;
          notify();
        },
      };
    },
    onOnlineHint: (listener: () => void) => {
      if (win === undefined) return () => {};
      if (onlineListeners.size === 0) win.addEventListener('online', handleOnline);
      onlineListeners.add(listener);
      return () => {
        onlineListeners.delete(listener);
        if (onlineListeners.size === 0) win.removeEventListener('online', handleOnline);
      };
    },
  };
}

export const connectionStore = createConnectionStore(
  typeof window === 'undefined' ? undefined : window,
);

export function useConnected(): boolean {
  return useSyncExternalStore(connectionStore.subscribe, connectionStore.getSnapshot, () => true);
}
