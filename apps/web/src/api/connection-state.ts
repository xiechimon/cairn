import { useEffect, useState, useSyncExternalStore } from 'react';

export const RECONNECT_GRACE_MS = 2_000;
export const LONG_OUTAGE_MS = 60_000;

export type OutagePhase = 'connected' | 'grace' | 'reconnecting' | 'long-outage';

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
  let disconnectedSince: number | null = null;

  const notify = (): void => {
    const next = [...streams.values()].every(Boolean);
    if (next === snapshot) return;
    snapshot = next;
    disconnectedSince = next ? null : Date.now();
    for (const listener of listeners) listener();
  };

  const handleOnline = (): void => {
    for (const listener of onlineListeners) listener();
  };

  const getOutagePhase = (now = Date.now()): OutagePhase => {
    if (snapshot || disconnectedSince === null) return 'connected';
    const elapsed = Math.max(0, now - disconnectedSince);
    if (elapsed < RECONNECT_GRACE_MS) return 'grace';
    if (elapsed < LONG_OUTAGE_MS) return 'reconnecting';
    return 'long-outage';
  };

  return {
    getSnapshot: () => snapshot,
    getDisconnectedSince: () => disconnectedSince,
    getOutagePhase,
    retryNow: () => {
      for (const listener of onlineListeners) listener();
    },
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

export function useConnectionOutage(): {
  connected: boolean;
  phase: OutagePhase;
  retryNow: () => void;
} {
  const connected = useConnected();
  const disconnectedSince = useSyncExternalStore(
    connectionStore.subscribe,
    connectionStore.getDisconnectedSince,
    () => null,
  );
  const [, setTick] = useState(0);

  useEffect(() => {
    if (connected || disconnectedSince === null) return;
    const elapsed = Math.max(0, Date.now() - disconnectedSince);
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (elapsed < RECONNECT_GRACE_MS) {
      timers.push(setTimeout(() => setTick((n) => n + 1), RECONNECT_GRACE_MS - elapsed));
    }
    if (elapsed < LONG_OUTAGE_MS) {
      timers.push(setTimeout(() => setTick((n) => n + 1), LONG_OUTAGE_MS - elapsed));
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [connected, disconnectedSince]);

  return {
    connected,
    phase: connectionStore.getOutagePhase(),
    retryNow: connectionStore.retryNow,
  };
}
