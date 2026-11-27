import { useSyncExternalStore } from 'react';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';

export const RUN_TRACE_HINT_KEY = 'cairn:run-trace-hint-seen';

let seenThisSession = false;
const listeners = new Set<() => void>();

function seen(): boolean {
  return seenThisSession || safeLocalStorage()?.getItem(RUN_TRACE_HINT_KEY) === '1';
}

export function markRunTraceHintSeen(): void {
  if (seen()) return;
  seenThisSession = true;
  safeSetItem(RUN_TRACE_HINT_KEY, '1');
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRunTraceHintSeen(): boolean {
  return useSyncExternalStore(subscribe, seen, () => true);
}
