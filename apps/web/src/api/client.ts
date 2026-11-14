import { parsePairFragment } from '@cairn/shared';
import { blockDemoWrite, DEMO_MODE } from '../demo/demo-gate.js';
import {
  awaitGate,
  bootstrapLoopback,
  clearLegacyBrowserToken,
  consumePairFragment,
  demandGate,
  exchangeAccessIdentity,
  isLoopbackPage,
} from './auth.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function send(path: string, init?: { method?: string; body?: unknown }): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  return fetch(path, {
    method: init?.method ?? 'GET',
    headers,
    credentials: 'same-origin',
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

if (typeof window !== 'undefined') clearLegacyBrowserToken();

let bootstrapped = false;

async function ensureLoopbackSession(): Promise<void> {
  if (DEMO_MODE || bootstrapped || typeof window === 'undefined' || !isLoopbackPage()) return;
  bootstrapped = true;
  await bootstrapLoopback();
}

let establishing: Promise<boolean> | null = null;

function establishSession(): Promise<boolean> {
  if (establishing !== null) return establishing;
  establishing = (async () => {
    if (DEMO_MODE) return false;
    if (parsePairFragment(window.location.hash) !== null) {
      let failed = false;
      await consumePairFragment(() => {
        failed = true;
      });
      if (failed) return false;
    }
    if ((await fetch('/api/teams')).ok) return true;
    if (await bootstrapLoopback()) return (await fetch('/api/teams')).ok;
    return (await exchangeAccessIdentity()) && (await fetch('/api/teams')).ok;
  })().finally(() => {
    establishing = null;
  });
  return establishing;
}

async function settle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      reason?: string;
    } | null;
    throw new ApiError(res.status, body?.error ?? res.statusText, body?.reason, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (init?.method != null && init.method !== 'GET' && blockDemoWrite()) {
    return new Promise<T>(() => {});
  }
  await ensureLoopbackSession();
  const first = await send(path, init);
  if (first.status !== 401) return settle<T>(first);
  if (await establishSession()) {
    const retried = await send(path, init);
    if (retried.status !== 401) return settle<T>(retried);
  }
  demandGate();
  await awaitGate();
  const second = await send(path, init);
  if (second.status === 401) demandGate();
  return settle<T>(second);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, body === undefined ? { method: 'DELETE' } : { method: 'DELETE', body }),
};
