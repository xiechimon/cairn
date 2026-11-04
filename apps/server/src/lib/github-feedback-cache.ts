import type { FetchLike } from './github.js';

export function conditionalFeedbackFetch(fetchImpl: FetchLike): FetchLike {
  const cache = new Map<
    string,
    { etag: string; body: unknown; headers: Awaited<ReturnType<FetchLike>>['headers'] }
  >();
  return async (input, init) => {
    const key = `${init?.headers?.authorization ?? ''}:${input}`;
    const cached = cache.get(key);
    const response = await fetchImpl(input, {
      ...init,
      headers: { ...init?.headers, ...(cached ? { 'if-none-match': cached.etag } : {}) },
    });
    if (response.status === 304 && cached) {
      return {
        ok: true,
        status: 200,
        headers: cached.headers,
        json: async () => cached.body,
        text: async () => JSON.stringify(cached.body),
      };
    }
    if (!response.ok) return response;
    const etag = response.headers.get('etag');
    if (etag === null) {
      cache.delete(key);
      return response;
    }
    const body = await response.json();
    cache.set(key, { etag, body, headers: response.headers });
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}
