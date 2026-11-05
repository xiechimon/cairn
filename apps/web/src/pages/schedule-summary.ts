import type { ScheduleRecord } from '../fixtures/records.js';
import type { TFunc } from '../i18n/translate.js';

export const TZ_OFFSET = 8 * 3_600_000;
export const pad = (n: number) => String(n).padStart(2, '0');
const hourMinute = (ts: number) => {
  const d = new Date(ts + TZ_OFFSET);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const EN_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const monthDay = (ts: number, t: TFunc) => {
  const d = new Date(ts + TZ_OFFSET);
  return t('{mo}月{d}日', {
    mo: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    monthShort: EN_MONTHS[d.getUTCMonth()] ?? '',
  });
};
const dayWord = (ts: number, now: number, t: TFunc) =>
  monthDay(ts, t) === monthDay(now, t) ? t('今天') : monthDay(ts, t);

const RUN_WORD: Record<ScheduleRecord['kind'], string> = {
  hourly: '每小时运行',
  daily: '每天运行',
  weekly: '每周运行',
  once: '运行一次',
  cron: 'Cron',
};

export function scheduleSummary(schedule: ScheduleRecord, now: number, t: TFunc): string {
  const start =
    schedule.kind === 'cron' ? '' : `${monthDay(schedule.at, t)} ${hourMinute(schedule.at)} `;
  if (schedule.nextRunAt === null) return `${start}${t(RUN_WORD[schedule.kind])} · ${t(schedule.kind === 'once' ? 'No upcoming runs' : 'Next run unavailable')}`;
  return `${start}${t(RUN_WORD[schedule.kind])} · ${t('下次 {day} {time}', {
    day: dayWord(schedule.nextRunAt, now, t),
    time: hourMinute(schedule.nextRunAt),
  })}`;
}
