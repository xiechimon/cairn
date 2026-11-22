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
  if (schedule.kind === 'event') return t('构建完成时');
  if (schedule.kind === 'webhook') return t('Webhook 调用时');
  if (schedule.kind === 'cron') {
    const weekdays = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(schedule.cron ?? '');
    if (weekdays !== null) {
      return t('工作日 {time}', {
        time: `${weekdays[2]?.padStart(2, '0')}:${weekdays[1]?.padStart(2, '0')}`,
      });
    }
    return t('Cron：{expression}', { expression: schedule.cron ?? '—' });
  }
  if (schedule.at === null) return t('定时时间不可用');
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
      return t('每小时第 {minute} 分', { minute });
    }
    if (schedule.kind === 'daily') return t('每天 {time}', { time });
    if (schedule.kind === 'weekly') {
      const day = new Intl.DateTimeFormat(formatLocale, {
        timeZone: schedule.tz,
        weekday: 'long',
      }).format(schedule.at);
      return t('每{weekday} {time}', { weekday: day, time });
    }
    const date = new Intl.DateTimeFormat(formatLocale, {
      timeZone: schedule.tz,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(schedule.at);
    return t('单次 {date} {time}', { date, time });
  } catch {
    return t('定时时间不可用');
  }
}

export function automationNextRun(at: number, now: number, t: TFunc): string {
  const minutes = Math.ceil((at - now) / 60_000);
  if (minutes <= 0) return t('下次运行已到时间');
  if (minutes < 60) return t('{n} 分钟后运行', { n: minutes });
  const hours = Math.ceil(minutes / 60);
  return hours < 24
    ? t('{n} 小时后运行', { n: hours })
    : t('{n} 天后运行', { n: Math.ceil(hours / 24) });
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
