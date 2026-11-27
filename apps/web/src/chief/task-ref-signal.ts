import { useSyncExternalStore } from 'react';

const GROW_STAGGER_MS = 350;

const listeners = new Set<() => void>();
const grown = new Set<string>();
const echoed = new Set<string>();
let hovered: string | null = null;

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function growDelays(todoIds: readonly string[], live: boolean): ReadonlyMap<string, number> {
  const fresh = live ? todoIds.filter((id) => !grown.has(id)) : [];
  return new Map(fresh.map((id, n) => [id, n * GROW_STAGGER_MS]));
}

export function markGrown(todoId: string) {
  grown.add(todoId);
}

export function echoTaskRef(todoId: string) {
  if (echoed.has(todoId) || !grown.has(todoId)) return;
  echoed.add(todoId);
  notify();
}

export function hoverTaskRef(todoId: string | null) {
  if (hovered === todoId) return;
  hovered = todoId;
  notify();
}

export function leaveTaskRef(todoId: string) {
  if (hovered !== todoId) return;
  hovered = null;
  notify();
}

export function readTaskRefSignal(todoId: string | undefined): {
  hovered: boolean;
  echo: boolean;
} {
  return {
    hovered: todoId !== undefined && hovered === todoId,
    echo: todoId !== undefined && echoed.has(todoId),
  };
}

export function useTaskRefSignal(todoId: string | undefined): {
  hovered: boolean;
  echo: boolean;
} {
  const read = () =>
    todoId === undefined ? '' : `${hovered === todoId ? 'h' : ''}${echoed.has(todoId) ? 'e' : ''}`;
  const snapshot = useSyncExternalStore(subscribe, read, read);
  return { hovered: snapshot.includes('h'), echo: snapshot.includes('e') };
}

export function useHoveredTaskRef(): string | null {
  const read = () => hovered;
  return useSyncExternalStore(subscribe, read, read);
}
