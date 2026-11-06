import { useSyncExternalStore } from 'react';

interface ConnectionWindow {
  navigator: { onLine: boolean };
  addEventListener: (type: 'online' | 'offline', listener: () => void) => void;
  removeEventListener: (type: 'online' | 'offline', listener: () => void) => void;
}

export function createConnectionStore(win: ConnectionWindow | undefined) {
  return {
    getSnapshot: () => win?.navigator.onLine ?? true,
    subscribe: (listener: () => void) => {
      if (win === undefined) return () => {};
      win.addEventListener('online', listener);
      win.addEventListener('offline', listener);
      return () => {
        win.removeEventListener('online', listener);
        win.removeEventListener('offline', listener);
      };
    },
  };
}

const store = createConnectionStore(typeof window === 'undefined' ? undefined : window);

export function useConnected(): boolean {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => true);
}
