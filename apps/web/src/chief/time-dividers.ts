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

export function timeDividerLabel(at: number, now: number, locale: 'zh' | 'en', t: TFunc): string {
  const tag = locale === 'zh' ? 'zh-CN' : 'en-US';
  const time = new Intl.DateTimeFormat(tag, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
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
