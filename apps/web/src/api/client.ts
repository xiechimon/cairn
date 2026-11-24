import { blockDemoWrite } from '../demo/demo-gate.js';
import { clearLegacyBrowserToken, fetchWithSession } from './auth.js';

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

type ApiRequest = { method?: string; body?: unknown; signal?: AbortSignal };

function send(path: string, init?: ApiRequest) {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  return fetchWithSession(path, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
  });
}

if (typeof window !== 'undefined') clearLegacyBrowserToken();

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

async function request<T>(path: string, init?: ApiRequest): Promise<T> {
  if (init?.method != null && init.method !== 'GET' && blockDemoWrite()) {
    return new Promise<T>(() => {});
  }
  return settle<T>(await send(path, init));
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, body === undefined ? { method: 'DELETE' } : { method: 'DELETE', body }),
};
