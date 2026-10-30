import { useSyncExternalStore } from 'react';

export const TOKEN_STORAGE_KEY = 'cairn.token';

export function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

let pushAuthWrites: Promise<void> = Promise.resolve();

export function syncPushAuthToken(token: string | null): Promise<void> {
  pushAuthWrites = pushAuthWrites.then(async () => {
    if (typeof caches === 'undefined') return;
    try {
      const cache = await caches.open('push-auth');
      if (token === null) await cache.delete('/__push-auth');
      else await cache.put('/__push-auth', new Response(JSON.stringify({ token })));
    } catch {}
  });
  return pushAuthWrites;
}

function writeToken(token: string | null): void {
  void syncPushAuthToken(token);
  try {
    if (token === null) localStorage.removeItem(TOKEN_STORAGE_KEY);
    else localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {}
}

export interface AuthSnapshot {
  gateOpen: boolean;
  rejected: boolean;
}

let snapshot: AuthSnapshot = { gateOpen: false, rejected: false };
const listeners = new Set<() => void>();
let gateWaiters: Array<() => void> = [];

function publish(gateOpen: boolean, rejected: boolean): void {
  snapshot = { gateOpen, rejected };
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
  if (snapshot.gateOpen) return;
  publish(true, false);
}

export function passGate(token: string): void {
  writeToken(token);
  const waiters = gateWaiters;
  gateWaiters = [];
  publish(false, false);
  for (const wake of waiters) wake();
}

export function beginGateProbe(): void {
  if (!snapshot.rejected) return;
  publish(snapshot.gateOpen, false);
}

export function rejectGate(): void {
  writeToken(null);
  publish(true, true);
}

const LOGIN_FRAGMENT_PREFIX = '#token=';

export async function consumeLoginFragment(): Promise<void> {
  const hash = window.location.hash;
  if (!hash.startsWith(LOGIN_FRAGMENT_PREFIX)) return;
  const token = decodeURIComponent(hash.slice(LOGIN_FRAGMENT_PREFIX.length));
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  if (token === '') return;
  try {
    const open = await fetch(PROBE_PATH);
    if (open.ok) return;
  } catch {
    return;
  }
  if (await probeToken(token)) passGate(token);
  else rejectGate();
}

export function awaitGate(): Promise<void> {
  if (!snapshot.gateOpen) return Promise.resolve();
  return new Promise<void>((resolve) => {
    gateWaiters.push(resolve);
  });
}
