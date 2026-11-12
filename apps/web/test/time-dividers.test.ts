import { describe, expect, test } from 'vitest';
import {
  messageStampLabel,
  needsTimeDivider,
  TIME_DIVIDER_GAP_MS,
  timeDividerLabel,
} from '../src/chief/time-dividers.js';
import { EN } from '../src/i18n/en.js';
import { type TFunc, translate } from '../src/i18n/translate.js';

const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).getTime();
const now = at(2026, 11, 10, 15, 0);
const zh: TFunc = (key, vars) => translate('zh', EN, key, vars);
const en: TFunc = (key, vars) => translate('en', EN, key, vars);

describe('needsTimeDivider', () => {
  test('first message never gets a divider', () => {
    expect(needsTimeDivider(null, now)).toBe(false);
  });
  test('only a gap above the threshold does', () => {
    expect(needsTimeDivider(now - TIME_DIVIDER_GAP_MS, now)).toBe(false);
    expect(needsTimeDivider(now - TIME_DIVIDER_GAP_MS - 1, now)).toBe(true);
  });
});

describe('timeDividerLabel', () => {
  test('today and yesterday carry the clock time', () => {
    expect(timeDividerLabel(at(2026, 11, 10, 11, 22), now, 'zh', zh)).toBe('今天 11:22');
    expect(timeDividerLabel(at(2026, 11, 9, 23, 5), now, 'zh', zh)).toBe('昨天 23:05');
    expect(timeDividerLabel(at(2026, 11, 9, 23, 5), now, 'en', en)).toBe('Yesterday 23:05');
  });
  test('older messages show the date, with the year only outside this year', () => {
    expect(timeDividerLabel(at(2026, 11, 3, 8, 0), now, 'en', en)).toBe('Nov 3 08:00');
    expect(timeDividerLabel(at(2025, 12, 31, 8, 0), now, 'en', en)).toBe('Dec 31, 2025 08:00');
  });
});

describe('messageStampLabel', () => {
  test('a message from today shows only its clock time, as in the chat draft', () => {
    expect(messageStampLabel(at(2026, 11, 10, 11, 20), now, 'zh', zh)).toBe('11:20');
  });
  test('older messages carry the day like the divider', () => {
    expect(messageStampLabel(at(2026, 11, 9, 23, 5), now, 'zh', zh)).toBe('昨天 23:05');
    expect(messageStampLabel(at(2026, 11, 3, 8, 0), now, 'en', en)).toBe('Nov 3 08:00');
  });
});
