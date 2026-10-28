import { awaitGate, demandGate, readStoredToken } from './auth.js';

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

function send(
  path: string,
  token: string | null,
  init?: { method?: string; body?: unknown },
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return fetch(path, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
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

function demandIfCurrent(sentWith: string | null): void {
  if (readStoredToken() === sentWith) demandGate();
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let token = readStoredToken();
  const first = await send(path, token, init);
  if (first.status !== 401) return settle<T>(first);
  demandIfCurrent(token);
  await awaitGate();
  token = readStoredToken();
  const second = await send(path, token, init);
  if (second.status === 401) demandIfCurrent(token);
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
