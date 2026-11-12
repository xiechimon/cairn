import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type StreamTimeoutArm, StreamWatchdog } from '../src/stream-watchdog.js';

const timeouts = { first: 100, idle: 200, body: 1000 };

function watch(
  overrides: { durationCapIsAbsolute?: boolean; progressExtendsDuration?: boolean } = {},
) {
  const trips: StreamTimeoutArm[] = [];
  const watchdog = new StreamWatchdog({
    timeouts,
    durationCapMs: 5000,
    durationCapIsAbsolute: overrides.durationCapIsAbsolute ?? false,
    progressExtendsDuration: overrides.progressExtendsDuration ?? false,
    onTrip: (arm) => trips.push(arm),
  });
  return { watchdog, trips };
}

describe('StreamWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('a pass with no event trips the first-event arm', () => {
    const { watchdog, trips } = watch();
    watchdog.startPass(true);
    vi.advanceTimersByTime(100);
    expect(trips).toEqual(['first']);
    expect(watchdog.trippedArm).toBe('first');
    expect(watchdog.message()).toBe('stream timeout (arm=first, first=100ms)');
  });

  test('silence after an event trips the idle arm', () => {
    const { watchdog, trips } = watch();
    watchdog.startPass(true);
    vi.advanceTimersByTime(50);
    watchdog.noteEvent();
    vi.advanceTimersByTime(199);
    expect(trips).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(trips).toEqual(['idle']);
  });

  test('a running tool call holds the idle and body arms until it ends', () => {
    const { watchdog, trips } = watch();
    watchdog.startPass(true);
    watchdog.noteToolCall('call-1', true);
    watchdog.noteEvent();
    vi.advanceTimersByTime(2000);
    expect(trips).toEqual([]);
    watchdog.noteToolCall('call-1', false);
    watchdog.noteEvent();
    vi.advanceTimersByTime(200);
    expect(trips).toEqual(['idle']);
  });

  test('progress extends the duration cap only when the cap is not absolute', () => {
    const extending = watch({ progressExtendsDuration: true });
    extending.watchdog.startPass(true);
    for (let elapsed = 0; elapsed < 6000; elapsed += 50) {
      vi.advanceTimersByTime(50);
      extending.watchdog.noteEvent();
      extending.watchdog.noteProgress();
    }
    expect(extending.trips).toEqual([]);
    extending.watchdog.stop();

    const absolute = watch({ durationCapIsAbsolute: true });
    absolute.watchdog.startPass(true);
    for (let elapsed = 0; elapsed < 6000; elapsed += 50) {
      vi.advanceTimersByTime(50);
      absolute.watchdog.keepAlive();
    }
    expect(absolute.trips).toEqual(['duration']);
    expect(absolute.watchdog.message()).toBe('stream timeout (arm=duration, cap=5000ms)');
  });

  test('a later pass does not restart the duration cap, and a cleared trip reports nothing', () => {
    const { watchdog, trips } = watch();
    watchdog.startPass(true);
    vi.advanceTimersByTime(100);
    expect(trips).toEqual(['first']);
    watchdog.clearTrip();
    expect(watchdog.trippedArm).toBeNull();
    expect(watchdog.message()).toBeNull();
    watchdog.startPass(false);
    for (let elapsed = 100; elapsed < 5000; elapsed += 50) {
      vi.advanceTimersByTime(50);
      watchdog.noteEvent();
    }
    expect(trips).toEqual(['first', 'duration']);
  });

  test('stop cancels every armed timer', () => {
    const { watchdog, trips } = watch();
    watchdog.startPass(true);
    watchdog.stop();
    vi.advanceTimersByTime(10_000);
    expect(trips).toEqual([]);
  });
});
