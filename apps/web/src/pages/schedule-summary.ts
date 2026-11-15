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
      weekday: 'short',
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

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_KEYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function scheduleCadence(schedule: ScheduleRecord, t: TFunc): string {
  const anchor = clockParts(schedule.at, schedule.tz);
  const time = `${anchor.hour}:${anchor.minute}`;
  if (schedule.kind === 'daily') return t('每天 {time}', { time });
  if (schedule.kind === 'weekly') {
    const day = WEEKDAY_KEYS[WEEKDAYS.indexOf(anchor.weekday ?? '')];
    return t('每{weekday} {time}', { weekday: day === undefined ? '' : t(day), time });
  }
  if (schedule.kind === 'hourly') return t('每小时运行');
  if (schedule.kind === 'once') return t('运行一次');
  return 'Cron';
}

export function scheduleNext(schedule: ScheduleRecord, now: number, t: TFunc): string {
  if (schedule.nextRunAt === null || schedule.nextRunAt === 0)
    return t(schedule.kind === 'once' ? 'No upcoming runs' : 'Next run unavailable');
  const next = clockParts(schedule.nextRunAt, schedule.tz);
  const current = clockParts(now, schedule.tz);
  const today =
    next.year === current.year && next.month === current.month && next.day === current.day;
  return t('下次 {day} {time}', {
    day: today ? t('今天') : monthDay(next, t),
    time: `${next.hour}:${next.minute}`,
  });
}

export function scheduleSummary(schedule: ScheduleRecord, now: number, t: TFunc): string {
  return `${scheduleCadence(schedule, t)} · ${scheduleNext(schedule, now, t)}`;
}
