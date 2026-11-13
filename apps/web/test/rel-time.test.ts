import { describe, expect, it } from 'vitest';
import { compactAge, isUsableTimestamp, joinMeta, relativeTime } from '../src/board/rel-time.js';
import { EN } from '../src/i18n/en.js';
import { translate, type TVars } from '../src/i18n/translate.js';

/** 13:35 on the r7 capture day, +08:00. */
const NOW = Date.parse('2026-09-21T13:35:00+08:00');
const MINUTE = 60_000;
const HOUR = 3_600_000;

const en = (source: string, vars?: TVars) => translate('en', EN, source, vars);

describe('relativeTime zh (canon anchors)', () => {
  it('under a minute → `刚刚`', () => {
    expect(relativeTime(NOW - 30 * 1000, NOW)).toBe('刚刚');
  });

  it('minute bucket → N `分钟前` (r7 02 anchor)', () => {
    expect(relativeTime(NOW - 9 * MINUTE, NOW)).toBe('9 分钟前');
  });

  it('same calendar day hours → N `小时前`', () => {
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe('3 小时前');
  });

  it('adjacent calendar days → `昨天` (r5b 10 anchor: 33 h)', () => {
    expect(relativeTime(NOW - 33 * HOUR, NOW)).toBe('昨天');
  });

  it('two calendar days → N `天前` (r7 01 anchor: 46 h)', () => {
    expect(relativeTime(NOW - 46 * HOUR, NOW)).toBe('2 天前');
  });
});

describe('relativeTime en (dict fallback)', () => {
  it('maps every bucket through the EN dict', () => {
    expect(relativeTime(NOW - 30 * 1000, NOW, en)).toBe('just now');
    expect(relativeTime(NOW - 9 * MINUTE, NOW, en)).toBe('9m ago');
    expect(relativeTime(NOW - 3 * HOUR, NOW, en)).toBe('3h ago');
    expect(relativeTime(NOW - 33 * HOUR, NOW, en)).toBe('yesterday');
    expect(relativeTime(NOW - 46 * HOUR, NOW, en)).toBe('2d ago');
  });
});

describe('compactAge', () => {
  it('names the largest whole unit on each side of its boundary', () => {
    expect(compactAge(NOW - 20_000, NOW)).toBe('1m');
    expect(compactAge(NOW - 59 * MINUTE, NOW)).toBe('59m');
    expect(compactAge(NOW - 60 * MINUTE, NOW)).toBe('1h');
    expect(compactAge(NOW - 23 * HOUR - 59 * MINUTE, NOW)).toBe('23h');
    expect(compactAge(NOW - 24 * HOUR, NOW)).toBe('1d');
    expect(compactAge(NOW - 7 * 24 * HOUR + MINUTE, NOW)).toBe('6d');
    expect(compactAge(NOW - 7 * 24 * HOUR, NOW)).toBe('1w');
    expect(compactAge(NOW - 400 * 24 * HOUR, NOW)).toBe('1y');
  });

  it('is empty without a usable start and never negative', () => {
    expect(compactAge(0, NOW)).toBe('');
    expect(compactAge(null, NOW)).toBe('');
    expect(compactAge(NOW + 5 * MINUTE, NOW)).toBe('1m');
  });
});

describe('isUsableTimestamp', () => {
  it('rejects epoch 0, null, undefined and NaN', () => {
    expect(isUsableTimestamp(0, NOW)).toBe(false);
    expect(isUsableTimestamp(null, NOW)).toBe(false);
    expect(isUsableTimestamp(undefined, NOW)).toBe(false);
    expect(isUsableTimestamp(Number.NaN, NOW)).toBe(false);
  });

  it('rejects a far-future value but tolerates clock skew', () => {
    expect(isUsableTimestamp(NOW + 365 * 24 * HOUR, NOW)).toBe(false);
    expect(isUsableTimestamp(NOW + MINUTE, NOW)).toBe(true);
  });

  it('accepts a past timestamp', () => {
    expect(isUsableTimestamp(NOW - HOUR, NOW)).toBe(true);
  });
});

describe('relativeTime without a usable start', () => {
  it('returns nothing for null, undefined, 0 and non-finite times', () => {
    for (const ts of [null, undefined, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(relativeTime(ts, NOW)).toBe('');
    }
  });

  it('joinMeta drops empty parts so no separator dangles', () => {
    expect(joinMeta(['#9', relativeTime(0, NOW)])).toBe('#9');
    expect(joinMeta(['#9', '2 小时前'])).toBe('#9 · 2 小时前');
    expect(joinMeta([null, ''])).toBe('');
  });
});
