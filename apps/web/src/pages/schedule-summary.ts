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

const clock = (hour: string | undefined, minute: string | undefined) =>
  `${(hour ?? '').padStart(2, '0')}:${(minute ?? '').padStart(2, '0')}`;

function cronCadence(cron: string, t: TFunc): string | null {
  const weekdays = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(cron);
  if (weekdays !== null) return t('工作日 {time}', { time: clock(weekdays[2], weekdays[1]) });
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron);
  if (daily !== null) return t('每天 {time}', { time: clock(daily[2], daily[1]) });
  const everyHours = /^\d{1,2} \*\/(\d{1,2}) \* \* \*$/.exec(cron);
  if (everyHours !== null) return t('每 {n} 小时', { n: Number(everyHours[1]) });
  if (/^\d{1,2} \* \* \* \*$/.test(cron)) return t('每小时运行');
  return null;
}

export function scheduleUnnamedCron(schedule: ScheduleRecord, t: TFunc): string | null {
  const cron = schedule.cron?.trim() ?? '';
  return schedule.kind === 'cron' && cronCadence(cron, t) === null ? cron : null;
}

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
  const cron = schedule.cron?.trim() ?? '';
  return cronCadence(cron, t) ?? t('自定义 {cron}', { cron });
}

export function scheduleWhen(at: number, tz: string, now: number, t: TFunc): string {
  const next = clockParts(at, tz);
  const current = clockParts(now, tz);
  const today =
    next.year === current.year && next.month === current.month && next.day === current.day;
  return `${today ? t('今天') : monthDay(next, t)} ${next.hour}:${next.minute}`;
}

export function scheduleNext(schedule: ScheduleRecord, now: number, t: TFunc): string {
  if (schedule.nextRunAt === null || schedule.nextRunAt === 0)
    return t(schedule.kind === 'once' ? 'No upcoming runs' : 'Next run unavailable');
  return t('下次 {when}', { when: scheduleWhen(schedule.nextRunAt, schedule.tz, now, t) });
}

export function scheduleSummary(schedule: ScheduleRecord, now: number, t: TFunc): string {
  return `${scheduleCadence(schedule, t)} · ${scheduleNext(schedule, now, t)}`;
}
