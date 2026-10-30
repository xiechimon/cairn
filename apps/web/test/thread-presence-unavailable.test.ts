import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { startThreadPresence } from '../src/pwa/thread-presence.js';

vi.hoisted(() => {
  vi.stubGlobal('crypto', undefined);
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => {
        throw new DOMException('Storage unavailable', 'SecurityError');
      },
    });
  }
});

vi.mock('../src/api/client.js', () => ({
  api: {
    post: vi.fn().mockRejectedValue(new Error('Offline')),
    del: vi.fn().mockRejectedValue(new Error('Offline')),
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('presence initializes without crypto or storage and silently tolerates unavailable requests', async () => {
  vi.useFakeTimers();
  const surface = new EventTarget();
  Object.defineProperty(surface, 'visibilityState', { value: 'visible' });
  vi.stubGlobal('document', surface);
  const stop = startThreadPresence('team', 'thread');
  await vi.advanceTimersByTimeAsync(0);
  expect(api.post).toHaveBeenCalledWith('/api/teams/team/presence', {
    todoId: 'thread',
    tabId: expect.any(String),
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(api.post).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(api.del).toHaveBeenCalledTimes(1);
});
