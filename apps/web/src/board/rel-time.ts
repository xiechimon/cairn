import type { TFunc } from '../i18n/translate.js';
import { translate } from '../i18n/translate.js';

const zhT: TFunc = (source, vars) => translate('zh', {}, source, vars);

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const TZ_OFFSET = 8 * HOUR;

function dayIndex(ts: number): number {
  return Math.floor((ts + TZ_OFFSET) / DAY);
}

export function relativeTime(ts: number, now: number, t: TFunc = zhT): string {
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
