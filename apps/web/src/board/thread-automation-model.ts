import type { ScheduleRecord } from '@cairn/shared';
import type { TFunc } from '../i18n/translate.js';

export function automationsForThread(
  schedules: readonly ScheduleRecord[],
  todoId: string,
): ScheduleRecord[] {
  return schedules.filter((schedule) => schedule.todoId === todoId);
}

export function automationFinished(schedule: ScheduleRecord): boolean {
  return (
    schedule.kind === 'once' &&
    schedule.nextRunAt === null &&
    schedule.lastRunAt !== null &&
    schedule.lastRunStatus === 'completed' &&
    schedule.pausedReason === null
  );
}

export function automationCadence(schedule: ScheduleRecord, locale: string, t: TFunc): string {
  if (schedule.kind === 'cron') {
    const weekdays = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(schedule.cron ?? '');
    if (weekdays !== null) {
      return t('Every weekday at {time}', {
        time: `${weekdays[2]?.padStart(2, '0')}:${weekdays[1]?.padStart(2, '0')}`,
      });
    }
    return t('Cron: {expression}', { expression: schedule.cron ?? '—' });
  }
  if (schedule.at === null) return t('Schedule time unavailable');
  try {
    const formatLocale = locale === 'zh' ? 'zh-CN' : 'en-GB';
    const time = new Intl.DateTimeFormat(formatLocale, {
      timeZone: schedule.tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(schedule.at);
    if (schedule.kind === 'hourly') {
      const minute = new Intl.DateTimeFormat(formatLocale, {
        timeZone: schedule.tz,
        minute: '2-digit',
      }).format(schedule.at);
      return t('Every hour at minute {minute}', { minute });
    }
    if (schedule.kind === 'daily') return t('Every day at {time}', { time });
    if (schedule.kind === 'weekly') {
      const day = new Intl.DateTimeFormat(formatLocale, {
        timeZone: schedule.tz,
        weekday: 'long',
      }).format(schedule.at);
      return t('Every {day} at {time}', { day, time });
    }
    const date = new Intl.DateTimeFormat(formatLocale, {
      timeZone: schedule.tz,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(schedule.at);
    return t('Once on {date} at {time}', { date, time });
  } catch {
    return t('Schedule time unavailable');
  }
}

export function automationNextRun(at: number, now: number, t: TFunc): string {
  const minutes = Math.ceil((at - now) / 60_000);
  if (minutes <= 0) return t('Next run is due');
  if (minutes < 60) return t('Next run in {n} {n#minute|minutes}', { n: minutes });
  const hours = Math.ceil(minutes / 60);
  return hours < 24
    ? t('Next run in {n} {n#hour|hours}', { n: hours })
    : t('Next run in {n} {n#day|days}', { n: Math.ceil(hours / 24) });
}

export function automationLastRunAge(at: number, now: number, locale: string): string {
  const elapsed = Math.max(0, now - at);
  const unit =
    elapsed >= 86_400_000
      ? 'day'
      : elapsed >= 3_600_000
        ? 'hour'
        : elapsed >= 60_000
          ? 'minute'
          : 'second';
  const duration =
    unit === 'day' ? 86_400_000 : unit === 'hour' ? 3_600_000 : unit === 'minute' ? 60_000 : 1000;
  return new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    numeric: 'always',
  }).format(-Math.floor(elapsed / duration), unit);
}
