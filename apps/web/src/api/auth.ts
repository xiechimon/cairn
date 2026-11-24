import {
  BROWSER_AUTH_HEADER,
  BROWSER_SESSION_PATH,
  isBrowserAuthExempt,
  type PairClaimResponse,
  parsePairFragment,
  type RemoteDescriptor,
} from '@cairn/shared';
import { useSyncExternalStore } from 'react';
import { DEMO_MODE } from '../demo/demo-gate.js';

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
  void syncPushAuthToken(null);
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {}
}

export type PairAttemptPhase = 'requesting' | 'pending' | 'denied' | 'expired' | 'unavailable';

export interface PairAttempt {
  phase: PairAttemptPhase;
  code: string | null;
  expiresAt: number | null;
}

export interface AuthSnapshot {
  gateOpen: boolean;
  rejected: boolean;
  pairing: boolean;
  retrying: boolean;
  pair: PairAttempt | null;
  generation: number;
}

type Gate = 'hidden' | 'waiting' | 'rejected';
type Verdict = 'authenticated' | 'signed-out';
type SessionRecovery = {
  phase: 'background' | 'looking-up' | 'redeeming' | 'confirming';
  controller: AbortController;
  result: Promise<boolean>;
  successor?: Promise<boolean>;
};

let gate: Gate = 'hidden';
let recovery: SessionRecovery | null = null;
let retrying = false;
let pairAttempt: PairAttempt | null = null;
let pairAbort: AbortController | null = null;
let snapshot: AuthSnapshot = {
  gateOpen: false,
  rejected: false,
  pairing: false,
  retrying: false,
  pair: null,
  generation: 0,
};
const listeners = new Set<() => void>();

function publish(confirmedReplacement = false): void {
  const gateOpen = retrying || gate !== 'hidden';
  const rejected = !retrying && gate === 'rejected';
  const busy = recovery?.phase === 'redeeming';
  const pair = pairAttempt;
  const generation =
    snapshot.generation + Number(confirmedReplacement || gateOpen !== snapshot.gateOpen);
  if (
    generation === snapshot.generation &&
    rejected === snapshot.rejected &&
    busy === snapshot.pairing &&
    retrying === snapshot.retrying &&
    pair === snapshot.pair
  ) {
    return;
  }
  snapshot = { gateOpen, rejected, pairing: busy, retrying, pair, generation };
  for (const listener of listeners) listener();
}

export async function signInWithOwnerToken(
  rawToken: string,
): Promise<'ok' | 'invalid' | 'unavailable'> {
  const token = rawToken.trim();
  if (token === '') return 'invalid';
  try {
    const response = await fetch(BROWSER_SESSION_PATH, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: 'error',
      headers: {
        [BROWSER_AUTH_HEADER]: '1',
        authorization: `Bearer ${token}`,
      },
    });
    if (response.status === 204) {
      applyVerdict('authenticated', 'waiting', true);
      return 'ok';
    }
    if (response.status === 401 || response.status === 403) return 'invalid';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function authSnapshot(): AuthSnapshot {
  return snapshot;
}

export function useAuth(): AuthSnapshot {
  return useSyncExternalStore(subscribeAuth, authSnapshot);
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const DESCRIPTOR_PATH = '/api/remote/descriptor';
const PAIR_PATH = '/api/remote/pair';
const PAIR_REQUEST_PATH = '/api/remote/pair/request';
const PAIR_CLAIM_PATH = '/api/remote/pair/claim';
const PAIR_CLAIM_POLL_MS = 2_000;
const SESSION_REQUEST_TIMEOUT_MS = 5_000;
const PROBE_RETRY_INITIAL_MS = 250;
const PROBE_RETRY_MAX_MS = 4_000;

async function withSessionRequestDeadline<T>(
  signal: AbortSignal,
  run: (requestSignal: AbortSignal) => Promise<T>,
): Promise<T | null> {
  if (signal.aborted) return null;

  const controller = new AbortController();
  const abort = () => controller.abort();
  let onAbort!: () => void;
  const cancelled = new Promise<null>((resolve) => {
    onAbort = () => resolve(null);
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  const timer = setTimeout(abort, SESSION_REQUEST_TIMEOUT_MS);
  signal.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.race([run(controller.signal), cancelled]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

async function probeSession(signal: AbortSignal): Promise<Verdict | null> {
  let delay = PROBE_RETRY_INITIAL_MS;
  while (!signal.aborted) {
    const response = await withSessionRequestDeadline(signal, (requestSignal) =>
      fetch(BROWSER_SESSION_PATH, {
        cache: 'no-store',
        credentials: 'same-origin',
        mode: 'same-origin',
        redirect: 'error',
        headers: { [BROWSER_AUTH_HEADER]: '1' },
        signal: requestSignal,
      }),
    );
    if (signal.aborted) return null;
    if (response !== null && !response.redirected) {
      if (response.status === 204) return 'authenticated';
      if (response.status === 401) return 'signed-out';
    }
    retrying = true;
    publish();
    if (signal.aborted) return null;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, delay);
      signal.addEventListener('abort', finish, { once: true });
    });
    delay = Math.min(delay * 2, PROBE_RETRY_MAX_MS);
  }
  return null;
}

function applyVerdict(
  verdict: Verdict,
  signedOutGate: Exclude<Gate, 'hidden'>,
  replacement = false,
): boolean {
  retrying = false;
  const authenticated = verdict === 'authenticated';
  if (authenticated) {
    abortPairAttempt();
    if (gate !== 'hidden' || replacement) clearLegacyBrowserToken();
    gate = 'hidden';
  } else if (verdict === 'signed-out' && (gate === 'hidden' || signedOutGate === 'rejected')) {
    gate = signedOutGate;
    clearLegacyBrowserToken();
  }
  publish(authenticated && replacement);
  return authenticated;
}

function browserDetail(): string | undefined {
  const ua = navigator.userAgent;
  const found =
    /Edg(?:e|A|iOS)?\/(\d+)/.exec(ua) ??
    /Chrome\/(\d+)/.exec(ua) ??
    /Firefox\/(\d+)/.exec(ua) ??
    (/Safari\//.test(ua) ? /Version\/(\d+)/.exec(ua) : null);
  if (found === null) return undefined;
  const name = ua.includes('Edg')
    ? 'Edge'
    : ua.includes('Chrome')
      ? 'Chrome'
      : ua.includes('Firefox')
        ? 'Firefox'
        : 'Safari';
  return `${name} ${found[1]}`;
}

function sleepOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

function abortPairAttempt(): void {
  pairAbort?.abort();
  pairAbort = null;
  pairAttempt = null;
}

export function ensurePairRequest(): void {
  if (
    DEMO_MODE ||
    retrying ||
    recovery?.phase === 'redeeming' ||
    recovery?.phase === 'looking-up'
  ) {
    return;
  }
  if (
    pairAttempt !== null &&
    (pairAttempt.phase === 'requesting' || pairAttempt.phase === 'pending')
  ) {
    return;
  }
  pairAbort?.abort();
  const controller = new AbortController();
  pairAbort = controller;
  pairAttempt = { phase: 'requesting', code: null, expiresAt: null };
  publish();
  void runPairAttempt(controller);
}

export function requestNewPairAttempt(): void {
  abortPairAttempt();
  if (gate === 'hidden') return;
  ensurePairRequest();
}

async function runPairAttempt(controller: AbortController): Promise<void> {
  const { signal } = controller;
  const platform =
    typeof navigator === 'undefined'
      ? 'Browser'
      : ((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
        'Browser');
  const detail = typeof navigator === 'undefined' ? undefined : browserDetail();
  let issued: { id: string; secret: string; code: string; expiresAt: number } | null = null;
  try {
    const response = await fetch(PAIR_REQUEST_PATH, {
      method: 'POST',
      redirect: 'error',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', [BROWSER_AUTH_HEADER]: '1' },
      body: JSON.stringify({
        name: platform ?? 'Browser',
        ...(detail === undefined ? {} : { detail }),
      }),
      signal,
    });
    if (response.status === 201 && !response.redirected) {
      issued = (await response.json()) as {
        id: string;
        secret: string;
        code: string;
        expiresAt: number;
      };
    }
  } catch {}
  if (signal.aborted) return;
  if (issued === null) {
    pairAttempt = { phase: 'unavailable', code: null, expiresAt: null };
    publish();
    return;
  }
  pairAttempt = { phase: 'pending', code: issued.code, expiresAt: issued.expiresAt };
  publish();
  while (!signal.aborted) {
    const wait = Math.min(PAIR_CLAIM_POLL_MS, issued.expiresAt - Date.now());
    if (wait <= 0) break;
    await sleepOrAbort(wait, signal);
    if (signal.aborted) return;
    let outcome: PairClaimResponse['status'] | 'gone' | 'retry' = 'retry';
    try {
      const response = await fetch(PAIR_CLAIM_PATH, {
        method: 'POST',
        redirect: 'error',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', [BROWSER_AUTH_HEADER]: '1' },
        body: JSON.stringify({ id: issued.id, secret: issued.secret }),
        signal,
      });
      if (signal.aborted) return;
      if (response.status === 404) outcome = 'gone';
      else if (response.ok && !response.redirected) {
        outcome = ((await response.json()) as PairClaimResponse).status;
      }
    } catch {}
    if (outcome === 'retry' || outcome === 'pending') continue;
    if (outcome === 'approved') {
      const verdict = await probeSession(signal);
      if (signal.aborted) return;
      if (verdict !== null && applyVerdict(verdict, 'waiting')) return;
      continue;
    }
    pairAttempt = {
      phase: outcome === 'denied' ? 'denied' : 'expired',
      code: pairAttempt?.code ?? issued.code,
      expiresAt: pairAttempt?.expiresAt ?? issued.expiresAt,
    };
    publish();
    return;
  }
  if (!signal.aborted && pairAttempt?.phase === 'pending') {
    pairAttempt = { ...pairAttempt, phase: 'expired' };
    publish();
  }
}

async function exchangeAccessIdentity(signal: AbortSignal): Promise<boolean> {
  if (DEMO_MODE || typeof window === 'undefined' || LOOPBACK_HOSTS.has(window.location.hostname)) {
    return false;
  }
  const response = await withSessionRequestDeadline(signal, (requestSignal) =>
    fetch('/api/auth/access', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      signal: requestSignal,
    }),
  );
  return response?.ok === true && !response.redirected;
}

async function checkSession(signal: AbortSignal): Promise<boolean> {
  let verdict = await probeSession(signal);
  if (signal.aborted) return false;
  const replaced = verdict === 'signed-out' && (await exchangeAccessIdentity(signal));
  if (signal.aborted) return false;
  if (replaced) verdict = await probeSession(signal);
  return verdict !== null && !signal.aborted && applyVerdict(verdict, 'waiting', replaced);
}

function startRecovery(
  phase: SessionRecovery['phase'],
  run: (operation: SessionRecovery) => Promise<boolean>,
): Promise<boolean> {
  const previous = recovery;
  const operation: SessionRecovery = {
    phase,
    controller: new AbortController(),
    result: Promise.resolve()
      .then(() => run(operation))
      .finally(() => {
        if (recovery === operation) recovery = null;
      })
      .then((authenticated) => operation.successor ?? authenticated),
  };
  recovery = operation;
  if (previous !== null) {
    previous.successor = operation.result;
    previous.controller.abort();
  }
  return operation.result;
}

function recoverSession(): Promise<boolean> {
  if (recovery !== null) return recovery.result;
  const link = DEMO_MODE ? null : consumePairFragment();
  return link ?? startRecovery('background', ({ controller }) => checkSession(controller.signal));
}

export async function fetchWithSession(path: string, init?: RequestInit): Promise<Response> {
  const page = new URL(globalThis.window?.location.href ?? 'http://localhost');
  const target = new URL(path, page);
  const protectedRequest = target.origin === page.origin && !isBrowserAuthExempt(target.pathname);
  const options: RequestInit = {
    ...init,
    credentials: 'same-origin',
    ...(protectedRequest ? { cache: init?.cache === 'no-store' ? 'no-store' : 'no-cache' } : {}),
  };
  const needsProbe = (response: Response) =>
    protectedRequest && !response.redirected && response.status === 401;
  const first = await fetch(path, options);
  if (!needsProbe(first) || !(await recoverSession())) return first;
  const retry = await fetch(path, options);
  if (needsProbe(retry)) await recoverSession();
  return retry;
}

export function consumePairFragment(): Promise<boolean> | null {
  if (typeof window === 'undefined') return null;
  const pair = parsePairFragment(window.location.hash);
  if (pair === null) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return redeemPairingCode(pair.code, pair.environmentId);
}

export function redeemPairingCode(code: string, environmentId?: string): Promise<boolean> {
  if (recovery?.phase === 'redeeming') return recovery.result;
  const phase = environmentId === undefined ? 'redeeming' : 'looking-up';
  const result = startRecovery(phase, async (operation) => {
    const { signal } = operation.controller;
    const matchesEnvironment =
      environmentId === undefined ||
      (await withSessionRequestDeadline(signal, async (requestSignal) => {
        const response = await fetch(DESCRIPTOR_PATH, { redirect: 'error', signal: requestSignal });
        if (requestSignal.aborted || !response.ok || response.redirected) return false;
        return ((await response.json()) as RemoteDescriptor).environmentId === environmentId;
      })) === true;
    if (signal.aborted) return false;
    if (matchesEnvironment) {
      operation.phase = 'redeeming';
      retrying = false;
      publish();
      try {
        const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData
          ?.platform;
        await fetch(PAIR_PATH, {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json', [BROWSER_AUTH_HEADER]: '1' },
          body: JSON.stringify({ code, name: platform || 'Browser', environmentId }),
        });
      } catch {}
    }
    operation.phase = 'confirming';
    retrying = true;
    publish();
    const verdict = await probeSession(signal);
    return verdict !== null && !signal.aborted && applyVerdict(verdict, 'rejected');
  });
  clearLegacyBrowserToken();
  gate = 'waiting';
  retrying = phase === 'looking-up';
  publish();
  return result;
}
