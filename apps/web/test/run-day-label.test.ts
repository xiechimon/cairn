import { afterEach, beforeEach, expect, test } from 'vitest';
import type { TFunc } from '../src/i18n/translate.js';
import { runDayLabel } from '../src/runs/run-list.js';

const t = ((key: string) => key) as TFunc;
let zone: string | undefined;

beforeEach(() => {
  zone = process.env.TZ;
  process.env.TZ = 'America/New_York';
});

afterEach(() => {
  process.env.TZ = zone;
});

test('a run late on the 23-hour daylight-saving day is 昨天 just after the next midnight', () => {
  const now = new Date(2026, 2, 9, 0, 30).getTime();
  expect(runDayLabel(new Date(2026, 2, 8, 23, 50).getTime(), now, 'zh', t)).toBe('昨天');
  expect(runDayLabel(new Date(2026, 2, 7, 23, 50).getTime(), now, 'zh', t)).not.toBe('昨天');
});
