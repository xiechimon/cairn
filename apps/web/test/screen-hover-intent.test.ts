import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  HOVER_DWELL_MS,
  HOVER_RELEASE_MS,
  screenHoverIntent,
  TOUCH_IDLE_MS,
} from '../src/board/screen-hover-control.js';

function setup() {
  const wants: boolean[] = [];
  const intent = screenHoverIntent((held) => wants.push(held));
  return { wants, intent };
}

describe('screen hover intent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('the pointer must rest on the screen for the dwell before control is wanted', () => {
    const { wants, intent } = setup();
    intent.enter();
    vi.advanceTimersByTime(HOVER_DWELL_MS - 1);
    expect(wants).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(wants).toEqual([true]);
  });

  test('a quick pass over the screen never asks for control', () => {
    const { wants, intent } = setup();
    intent.enter();
    vi.advanceTimersByTime(HOVER_DWELL_MS / 2);
    intent.leave();
    vi.advanceTimersByTime(HOVER_RELEASE_MS * 2);
    expect(wants).toEqual([]);
  });

  test('leaving releases after the delay, and coming back within it keeps control', () => {
    const { wants, intent } = setup();
    intent.enter();
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    intent.leave();
    vi.advanceTimersByTime(HOVER_RELEASE_MS - 1);
    intent.enter();
    vi.advanceTimersByTime(HOVER_RELEASE_MS * 2);
    expect(wants).toEqual([true]);
    intent.leave();
    vi.advanceTimersByTime(HOVER_RELEASE_MS);
    expect(wants).toEqual([true, false]);
  });

  test('a tap takes control at once, a tap outside releases it', () => {
    const { wants, intent } = setup();
    intent.touch();
    expect(wants).toEqual([true]);
    intent.touchOutside();
    expect(wants).toEqual([true, false]);
  });

  test('a touch hold ends after the idle time with no taps, and each tap restarts it', () => {
    const { wants, intent } = setup();
    intent.touch();
    vi.advanceTimersByTime(TOUCH_IDLE_MS - 1);
    intent.touch();
    vi.advanceTimersByTime(TOUCH_IDLE_MS - 1);
    expect(wants).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(wants).toEqual([true, false]);
  });

  test('dispose drops pending timers and releases a held screen', () => {
    const { wants, intent } = setup();
    intent.enter();
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    intent.dispose();
    vi.advanceTimersByTime(TOUCH_IDLE_MS);
    expect(wants).toEqual([true, false]);
  });
});
