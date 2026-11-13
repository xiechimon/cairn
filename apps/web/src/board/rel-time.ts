import type { TFunc } from '../i18n/translate.js';
import { translate } from '../i18n/translate.js';

const zhT: TFunc = (source, vars) => translate('zh', {}, source, vars);

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const CLOCK_SKEW = 5 * MINUTE;
const TZ_OFFSET = 8 * HOUR;

export function dayIndex(ts: number): number {
  return Math.floor((ts + TZ_OFFSET) / DAY);
}

export function relativeTime(ts: number | null | undefined, now: number, t: TFunc = zhT): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return '';
  const diff = now - ts;
  if (diff < MINUTE) return t('刚刚');
  const minutes = Math.floor(diff / MINUTE);
  if (minutes < 60) return t('{n} 分钟前', { n: minutes });
  const days = dayIndex(now) - dayIndex(ts);
  if (days <= 0) {
    const hours = Math.floor(diff / HOUR);
    return t('{n} 小时前', { n: hours });
  }
  if (days === 1) return t('昨天');
  return t('{n} 天前', { n: days });
}

export function isUsableTimestamp(ts: number | null | undefined, now: number): ts is number {
  return typeof ts === 'number' && Number.isFinite(ts) && ts > 0 && ts <= now + CLOCK_SKEW;
}

export function compactAge(ts: number | null | undefined, now: number): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return '';
  const diff = Math.max(now - ts, 0);
  if (diff < HOUR) return `${Math.max(Math.floor(diff / MINUTE), 1)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  if (diff < 365 * DAY) return `${Math.floor(diff / (7 * DAY))}w`;
  return `${Math.floor(diff / (365 * DAY))}y`;
}

export function joinMeta(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part) => part != null && part !== '').join(' · ');
}

export function shortDate(ts: number | null | undefined, t: TFunc = zhT): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return '';
  const local = new Date(ts + TZ_OFFSET);
  return t('{mo}月{d}日', {
    mo: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    monthShort: local.toLocaleString('en', { month: 'short', timeZone: 'UTC' }),
  });
}
