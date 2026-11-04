import { afterEach, expect, test, vi } from 'vitest';
import { syncPushAuthToken } from '../src/api/auth.js';

afterEach(() => vi.unstubAllGlobals());

test('worker credentials are written, rotated and removed in request order', async () => {
  const operations: string[] = [];
  let release: (() => void) | undefined;
  const cache = {
    put: vi.fn(async (_path: string, response: Response) => {
      const { token } = await response.json();
      if (token === 'old') await new Promise<void>((resolve) => { release = resolve; });
      operations.push(token);
    }),
    delete: vi.fn(async () => { operations.push('removed'); }),
  };
  vi.stubGlobal('caches', { open: async () => cache });
  const old = syncPushAuthToken('old');
  await vi.waitFor(() => expect(release).toBeDefined());
  const rotated = syncPushAuthToken('new');
  const removed = syncPushAuthToken(null);
  release?.();
  await Promise.all([old, rotated, removed]);
  expect(operations).toEqual(['old', 'new', 'removed']);
});

test('unavailable worker storage does not prevent authentication', async () => {
  vi.stubGlobal('caches', { open: async () => { throw new Error('storage denied'); } });
  await expect(syncPushAuthToken('token')).resolves.toBeUndefined();
});
