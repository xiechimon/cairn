import { describe, expect, test } from 'vitest';
import { resolveSnooze, zonedWallToEpoch } from '../src/lib/snooze-time.js';

const SHANGHAI = 'Asia/Shanghai';
const at = (iso: string) => Date.parse(iso);

describe('resolveSnooze presets in Asia/Shanghai', () => {
  test.each([
    [
      '23:30 tomorrow -> 08:00 the next day',
      '2026-11-02T23:30:00+08:00',
      '2026-11-03T08:00:00+08:00',
    ],
    [
      '02:00 tomorrow -> 08:00 the same day',
      '2026-11-02T02:00:00+08:00',
      '2026-11-02T08:00:00+08:00',
    ],
    [
      'exactly 08:00 rolls to the next day',
      '2026-11-02T08:00:00+08:00',
      '2026-11-03T08:00:00+08:00',
    ],
    ['07:59 stays on the same day', '2026-11-02T07:59:00+08:00', '2026-11-02T08:00:00+08:00'],
    [
      'month end rolls into the next month',
      '2026-11-30T23:30:00+08:00',
      '2026-12-01T08:00:00+08:00',
    ],
    ['year end rolls into the next year', '2026-12-31T23:30:00+08:00', '2027-01-01T08:00:00+08:00'],
  ])('tomorrow: %s', (_name, now, expected) => {
    expect(resolveSnooze('tomorrow', at(now), SHANGHAI)).toEqual({
      mode: 'until',
      until: at(expected),
    });
  });

  test.each([
    [
      '02:00 still means the next calendar day',
      '2026-11-02T02:00:00+08:00',
      '2026-11-03T09:00:00+08:00',
    ],
    ['23:30 means the next calendar day', '2026-11-02T23:30:00+08:00', '2026-11-03T09:00:00+08:00'],
  ])('tomorrow-09:00: %s', (_name, now, expected) => {
    expect(resolveSnooze('tomorrow-09:00', at(now), SHANGHAI)).toEqual({
      mode: 'until',
      until: at(expected),
    });
  });

  test.each([
    ['Sunday', '2026-11-01T12:00:00+08:00', '2026-11-02T09:00:00+08:00'],
    ['Monday morning goes a week ahead', '2026-11-02T07:00:00+08:00', '2026-11-09T09:00:00+08:00'],
    ['Saturday', '2026-10-31T23:59:00+08:00', '2026-11-02T09:00:00+08:00'],
    ['Wednesday', '2026-11-04T10:00:00+08:00', '2026-11-09T09:00:00+08:00'],
  ])('next-monday from %s', (_name, now, expected) => {
    expect(resolveSnooze('next-monday', at(now), SHANGHAI)).toEqual({
      mode: 'until',
      until: at(expected),
    });
  });
});

describe('resolveSnooze other inputs', () => {
  test('needed has no timestamp', () => {
    expect(resolveSnooze('needed', at('2026-11-02T02:00:00+08:00'), SHANGHAI)).toEqual({
      mode: 'needed',
      until: null,
    });
  });

  test('the zone decides the wall clock for the same instant', () => {
    const now = at('2026-11-02T20:00:00Z');
    expect(resolveSnooze('tomorrow', now, 'Asia/Shanghai').until).toBe(
      at('2026-11-03T08:00:00+08:00'),
    );
    expect(resolveSnooze('tomorrow', now, 'UTC').until).toBe(at('2026-11-03T08:00:00Z'));
    expect(resolveSnooze('tomorrow', now, 'America/Los_Angeles').until).toBe(
      at('2026-11-03T08:00:00-08:00'),
    );
  });

  test('daylight saving: 09:00 wall time keeps its wall time across the change', () => {
    expect(
      resolveSnooze('tomorrow-09:00', at('2026-03-07T12:00:00-08:00'), 'America/Los_Angeles').until,
    ).toBe(at('2026-03-08T09:00:00-07:00'));
  });

  test('an epoch timestamp in the future is kept as is', () => {
    const now = at('2026-11-02T02:00:00+08:00');
    expect(resolveSnooze(now + 60_000, now, SHANGHAI)).toEqual({
      mode: 'until',
      until: now + 60_000,
    });
  });

  test('an ISO timestamp is parsed with its offset', () => {
    const now = at('2026-11-02T02:00:00+08:00');
    expect(resolveSnooze('2026-11-02T10:30:00+08:00', now, SHANGHAI)).toEqual({
      mode: 'until',
      until: at('2026-11-02T10:30:00+08:00'),
    });
  });

  test.each([
    ['a past epoch', 1_000],
    ['now itself', at('2026-11-02T02:00:00+08:00')],
    ['a past ISO timestamp', '2026-11-01T00:00:00Z'],
    ['an unknown preset', 'soon'],
    ['a non-finite number', Number.NaN],
  ])('rejects %s', (_name, until) => {
    expect(() => resolveSnooze(until, at('2026-11-02T02:00:00+08:00'), SHANGHAI)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  test('rejects an unknown time zone', () => {
    expect(() => resolveSnooze('tomorrow', Date.now(), 'Mars/Olympus')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe('zonedWallToEpoch', () => {
  test('converts a wall time to the instant in that zone', () => {
    expect(zonedWallToEpoch({ year: 2026, month: 11, day: 3, hour: 8, minute: 0 }, SHANGHAI)).toBe(
      at('2026-11-03T08:00:00+08:00'),
    );
  });

  test('day overflow rolls over the month', () => {
    expect(zonedWallToEpoch({ year: 2026, month: 11, day: 31, hour: 9, minute: 0 }, 'UTC')).toBe(
      at('2026-12-01T09:00:00Z'),
    );
  });
});
