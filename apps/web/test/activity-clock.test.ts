import { afterEach, expect, test, vi } from 'vitest';
import { nextLocalMidnight, startActivityClock } from '../src/search/activity-clock.js';

const originalTimezone = process.env.TZ;
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

test('next civil midnight follows 23- and 25-hour DST days', () => {
  process.env.TZ = 'America/Los_Angeles';
  for (const [month, day, hours] of [[2, 8, 23], [10, 1, 25]] as const) {
    const now = new Date(2026, month, day).getTime();
    expect(nextLocalMidnight(now) - now).toBe(hours * 3_600_000);
  }
});

test('idle clock repeats at midnight, including Monday, without polling', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 8, 23, 59, 59));
  vi.stubGlobal('document', new EventTarget());
  const refresh = vi.fn();
  const stop = startActivityClock(refresh);
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(new Date(refresh.mock.calls[0]?.[0]).getDay()).toBe(1);
  vi.advanceTimersByTime(24 * 3_600_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(1);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});

test('visibility catches a suspended midnight once and cleanup removes timer and listener', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 4, 12));
  let visibility = 'hidden';
  const surface = new EventTarget();
  Object.defineProperty(surface, 'visibilityState', { get: () => visibility });
  vi.stubGlobal('document', surface);
  const refresh = vi.fn();
  const stop = startActivityClock(refresh);
  vi.setSystemTime(new Date(2026, 10, 6, 12));
  surface.dispatchEvent(new Event('visibilitychange'));
  expect(refresh).not.toHaveBeenCalled();
  visibility = 'visible';
  surface.dispatchEvent(new Event('visibilitychange'));
  surface.dispatchEvent(new Event('visibilitychange'));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
  stop();
  vi.setSystemTime(new Date(2026, 10, 7, 12));
  surface.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(24 * 3_600_000);
  expect(refresh).toHaveBeenCalledTimes(1);
});
