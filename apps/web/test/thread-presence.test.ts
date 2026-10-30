import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { startThreadPresence } from '../src/pwa/thread-presence.js';

vi.mock('../src/api/client.js', () => ({ api: { post: vi.fn().mockResolvedValue({ ok: true }), del: vi.fn().mockResolvedValue({ ok: true }) } }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test('heartbeats every 30 seconds and clears presence on hide and cleanup', async () => {
  vi.useFakeTimers();
  let visibilityState = 'visible';
  const surface = new EventTarget();
  Object.defineProperty(surface, 'visibilityState', { get: () => visibilityState });
  vi.stubGlobal('document', surface);
  const stop = startThreadPresence('team', 'thread');
  await vi.advanceTimersByTimeAsync(0);
  expect(api.post).toHaveBeenLastCalledWith('/api/teams/team/presence', { todoId: 'thread', tabId: expect.any(String) });
  expect(api.post).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(api.post).toHaveBeenCalledTimes(2);
  visibilityState = 'hidden';
  surface.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(api.del).toHaveBeenLastCalledWith('/api/teams/team/presence', { todoId: 'thread', tabId: expect.any(String) });
  expect(api.del).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(api.post).toHaveBeenCalledTimes(2);
  visibilityState = 'visible';
  surface.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(api.post).toHaveBeenCalledTimes(3);
  stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(api.del).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  surface.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(api.post).toHaveBeenCalledTimes(3);
});

test('hidden pages start heartbeating when made visible and tolerate request failures', async () => {
  vi.useFakeTimers();
  let visibilityState = 'hidden';
  const surface = new EventTarget();
  Object.defineProperty(surface, 'visibilityState', { get: () => visibilityState });
  vi.stubGlobal('document', surface);
  vi.mocked(api.post).mockRejectedValueOnce(new Error('Offline'));
  const stop = startThreadPresence('team', 'thread');
  expect(api.post).not.toHaveBeenCalled();
  visibilityState = 'visible';
  surface.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(api.post).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(0);
});


test('presence clear waits for an in-flight heartbeat so it cannot restore suppression after hiding', async () => {
  vi.useFakeTimers();
  let visibilityState = 'visible';
  const surface = new EventTarget();
  Object.defineProperty(surface, 'visibilityState', { get: () => visibilityState });
  vi.stubGlobal('document', surface);
  let release: (() => void) | undefined;
  vi.mocked(api.post).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const stop = startThreadPresence('team', 'thread');
  await vi.advanceTimersByTimeAsync(0);
  expect(api.post).toHaveBeenCalledTimes(1);
  visibilityState = 'hidden';
  surface.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(api.del).not.toHaveBeenCalled();
  release?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(api.del).toHaveBeenCalledTimes(1);
  stop();
});


test('a remounted view sends its heartbeat after the previous view has cleared presence', async () => {
  vi.useFakeTimers();
  const surface = new EventTarget();
  Object.defineProperty(surface, 'visibilityState', { value: 'visible' });
  vi.stubGlobal('document', surface);
  const operations: string[] = [];
  let release: (() => void) | undefined;
  vi.mocked(api.post).mockImplementationOnce(() => new Promise<void>((resolve) => {
    operations.push('view');
    release = resolve;
  })).mockImplementationOnce(async () => { operations.push('view'); });
  vi.mocked(api.del).mockImplementationOnce(async () => { operations.push('clear'); });
  const stopFirst = startThreadPresence('team', 'thread');
  await vi.advanceTimersByTimeAsync(0);
  stopFirst();
  const stopSecond = startThreadPresence('team', 'thread');
  await vi.advanceTimersByTimeAsync(0);
  expect(api.post).toHaveBeenCalledTimes(1);
  release?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(operations).toEqual(['view', 'clear', 'view']);
  stopSecond();
  await vi.advanceTimersByTimeAsync(0);
});


test('distinct tabs send their own identity with heartbeat and clear', async () => {
  vi.useFakeTimers();
  const surface = new EventTarget();
  Object.defineProperty(surface, 'visibilityState', { value: 'visible' });
  vi.stubGlobal('document', surface);
  const stopFirst = startThreadPresence('team', 'thread', 'first-tab');
  const stopSecond = startThreadPresence('team', 'thread', 'second-tab');
  await vi.advanceTimersByTimeAsync(0);
  expect(api.post).toHaveBeenCalledWith('/api/teams/team/presence', { todoId: 'thread', tabId: 'first-tab' });
  expect(api.post).toHaveBeenCalledWith('/api/teams/team/presence', { todoId: 'thread', tabId: 'second-tab' });
  stopFirst();
  await vi.advanceTimersByTimeAsync(0);
  expect(api.del).toHaveBeenCalledTimes(1);
  expect(api.del).toHaveBeenLastCalledWith('/api/teams/team/presence', { todoId: 'thread', tabId: 'first-tab' });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(api.post).toHaveBeenLastCalledWith('/api/teams/team/presence', { todoId: 'thread', tabId: 'second-tab' });
  stopSecond();
  await vi.advanceTimersByTimeAsync(0);
});
