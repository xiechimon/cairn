import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let openNow = false;

export function setDrawerOpen(next: boolean): void {
  if (openNow === next) return;
  openNow = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDrawerOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => openNow,
    () => false,
  );
}
