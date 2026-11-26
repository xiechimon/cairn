import type { TFunc } from '../i18n/translate.js';
import { dateTimeFormat, formatClockTime } from './date-format.js';

export const TIME_DIVIDER_GAP_MS = 60 * 60 * 1000;

function startOfDay(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

const daysBetween = (at: number, now: number) =>
  Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);

export function needsTimeDivider(previousAt: number | null, at: number): boolean {
  if (previousAt === null) return false;
  return at - previousAt > TIME_DIVIDER_GAP_MS || daysBetween(previousAt, at) !== 0;
}

export function messageStampLabel(at: number, now: number, locale: 'zh' | 'en', t: TFunc): string {
  return daysBetween(at, now) === 0
    ? formatClockTime(at, locale)
    : timeDividerLabel(at, now, locale, t);
}

export function timeDividerLabel(at: number, now: number, locale: 'zh' | 'en', t: TFunc): string {
  const tag = locale === 'zh' ? 'zh-CN' : 'en-US';
  const time = formatClockTime(at, locale);
  const days = daysBetween(at, now);
  if (days === 0) return t('今天 {time}', { time });
  if (days === 1) return t('昨天 {time}', { time });
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  const date = dateTimeFormat(tag, {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
  }).format(at);
  return `${date} ${time}`;
}
