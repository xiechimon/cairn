import type { ScheduleRecord } from '../fixtures/records.js';
import type { TFunc } from '../i18n/translate.js';

const clockParts = (ts: number, tz: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(ts)
      .map(({ type, value }) => [type, value]),
  );
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
const monthDay = (clock: Record<string, string>, t: TFunc) =>
  t('{mo}月{d}日', {
    mo: Number(clock.month),
    d: Number(clock.day),
    monthShort: EN_MONTHS[Number(clock.month) - 1] ?? '',
  });

const RUN_WORD: Record<ScheduleRecord['kind'], string> = {
  hourly: '每小时运行',
  daily: '每天运行',
  weekly: '每周运行',
  once: '运行一次',
  cron: 'Cron',
};

export function scheduleSummary(schedule: ScheduleRecord, now: number, t: TFunc): string {
  const anchor = clockParts(schedule.at, schedule.tz);
  const start =
    schedule.kind === 'cron' ? '' : `${monthDay(anchor, t)} ${anchor.hour}:${anchor.minute} `;
  if (schedule.nextRunAt === null || schedule.nextRunAt === 0)
    return `${start}${t(RUN_WORD[schedule.kind])} · ${t(schedule.kind === 'once' ? 'No upcoming runs' : 'Next run unavailable')}`;
  const next = clockParts(schedule.nextRunAt, schedule.tz);
  const current = clockParts(now, schedule.tz);
  const today =
    next.year === current.year && next.month === current.month && next.day === current.day;
  return `${start}${t(RUN_WORD[schedule.kind])} · ${t('下次 {day} {time}', {
    day: today ? t('今天') : monthDay(next, t),
    time: `${next.hour}:${next.minute}`,
  })}`;
}
