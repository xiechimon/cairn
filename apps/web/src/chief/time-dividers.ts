import type { TFunc } from '../i18n/translate.js';

export const TIME_DIVIDER_GAP_MS = 10 * 60 * 1000;

export function needsTimeDivider(previousAt: number | null, at: number): boolean {
  return previousAt !== null && at - previousAt > TIME_DIVIDER_GAP_MS;
}

function startOfDay(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function clockTime(at: number, locale: 'zh' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

const daysBetween = (at: number, now: number) =>
  Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);

export function messageStampLabel(at: number, now: number, locale: 'zh' | 'en', t: TFunc): string {
  return daysBetween(at, now) === 0 ? clockTime(at, locale) : timeDividerLabel(at, now, locale, t);
}

export function timeDividerLabel(at: number, now: number, locale: 'zh' | 'en', t: TFunc): string {
  const tag = locale === 'zh' ? 'zh-CN' : 'en-US';
  const time = clockTime(at, locale);
  const days = daysBetween(at, now);
  if (days === 0) return t('今天 {time}', { time });
  if (days === 1) return t('昨天 {time}', { time });
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  const date = new Intl.DateTimeFormat(tag, {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
  }).format(at);
  return `${date} ${time}`;
}
