import { useSyncExternalStore } from 'react';

export const TOKEN_STORAGE_KEY = 'cairn.token';

export function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_STORAGE_KEY);
    else localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {}
}

export interface AuthSnapshot {
  gateOpen: boolean;
}

let snapshot: AuthSnapshot = { gateOpen: false };
const listeners = new Set<() => void>();
let gateWaiters: Array<() => void> = [];

function publish(gateOpen: boolean): void {
  snapshot = { gateOpen };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAuth(): AuthSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

const PROBE_PATH = '/api/teams';

export async function probeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(PROBE_PATH, { headers: { authorization: `Bearer ${token}` } });
    return res.ok;
  } catch {
    return false;
  }
}

export function demandGate(): void {
  writeToken(null);
  if (!snapshot.gateOpen) publish(true);
}

export function passGate(token: string): void {
  writeToken(token);
  const waiters = gateWaiters;
  gateWaiters = [];
  publish(false);
  for (const wake of waiters) wake();
}

export function awaitGate(): Promise<void> {
  if (!snapshot.gateOpen) return Promise.resolve();
  return new Promise<void>((resolve) => {
    gateWaiters.push(resolve);
  });
}
