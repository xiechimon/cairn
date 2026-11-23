import type { MiddlewareHandler } from 'hono';
import { etag } from 'hono/etag';

const VARY_VALUES = ['Accept-Encoding', 'Cookie', 'Authorization'];

function mergeVary(headers: Headers): void {
  const current = headers.get('vary');
  if (current === null) {
    headers.set('vary', VARY_VALUES.join(', '));
    return;
  }
  if (current.trim() === '*') return;
  const present = new Set(current.split(',').map((value) => value.trim().toLowerCase()));
  const missing = VARY_VALUES.filter((value) => !present.has(value.toLowerCase()));
  if (missing.length > 0) headers.set('vary', `${current}, ${missing.join(', ')}`);
}

export function conditionalGet(): MiddlewareHandler {
  const tag = etag({ weak: true });
  return async (c, next) => {
    await tag(c, next);
    if (c.res.status === 200 || c.res.status === 304) {
      c.res.headers.set('cache-control', 'private, no-cache');
      mergeVary(c.res.headers);
    }
  };
}
