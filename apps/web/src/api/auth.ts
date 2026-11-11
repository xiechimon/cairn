import { type PairResponse, parsePairFragment, type RemoteDescriptor } from '@cairn/shared';
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

export function clearLegacyBrowserToken(): void {
  clearStoredToken();
}

function clearStoredToken(): void {
  void syncPushAuthToken(null);
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {}
}

export interface AuthSnapshot {
  gateOpen: boolean;
  rejected: boolean;
  generation: number;
}

let snapshot: AuthSnapshot = { gateOpen: false, rejected: false, generation: 0 };
const listeners = new Set<() => void>();
let gateWaiters: Array<() => void> = [];

function publish(gateOpen: boolean, rejected: boolean, acceptedToken = false): void {
  snapshot = {
    gateOpen,
    rejected,
    generation: snapshot.generation + Number(acceptedToken || gateOpen !== snapshot.gateOpen),
  };
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
  clearStoredToken();
  if (snapshot.gateOpen) return;
  publish(true, false);
}

export function passGate(): void {
  clearStoredToken();
  const waiters = gateWaiters;
  gateWaiters = [];
  publish(false, false, true);
  for (const wake of waiters) wake();
}

export function beginGateProbe(): void {
  if (!snapshot.rejected) return;
  publish(snapshot.gateOpen, false);
}

export function rejectGate(): void {
  clearStoredToken();
  publish(true, true);
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isLoopbackPage(): boolean {
  return LOOPBACK_HOSTS.has(window.location.hostname);
}

export async function bootstrapLoopback(): Promise<boolean> {
  if (!isLoopbackPage()) return false;
  try {
    const res = await fetch('/api/auth/bootstrap', { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

const DESCRIPTOR_PATH = '/api/remote/descriptor';
const PAIR_PATH = '/api/remote/pair';
const FALLBACK_DEVICE_NAME = 'Browser';

function pairedDeviceName(): string {
  const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return platform !== undefined && platform !== '' ? platform : FALLBACK_DEVICE_NAME;
}

export async function consumePairFragment(
  onFailure: (error: unknown) => void = () => {},
): Promise<void> {
  const pair = parsePairFragment(window.location.hash);
  if (pair === null) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  try {
    const descriptor = await fetch(DESCRIPTOR_PATH);
    if (!descriptor.ok) throw new Error(`descriptor ${descriptor.status}`);
    const { environmentId } = (await descriptor.json()) as RemoteDescriptor;
    if (environmentId !== pair.environmentId) throw new Error('environment mismatch');
    const res = await fetch(PAIR_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pair.code, name: pairedDeviceName() }),
    });
    if (!res.ok) throw new Error(`pair ${res.status}`);
    const paired = (await res.json()) as PairResponse;
    if (paired.environmentId !== pair.environmentId) throw new Error('environment mismatch');
    passGate();
  } catch (error) {
    onFailure(error);
  }
}

export async function redeemPairingCode(code: string): Promise<boolean> {
  try {
    const descriptor = await fetch(DESCRIPTOR_PATH);
    if (!descriptor.ok) return false;
    const res = await fetch(PAIR_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name: pairedDeviceName() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function awaitGate(): Promise<void> {
  if (!snapshot.gateOpen) return Promise.resolve();
  return new Promise<void>((resolve) => {
    gateWaiters.push(resolve);
  });
}
