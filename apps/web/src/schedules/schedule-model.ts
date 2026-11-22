import type { CreateScheduleBody, ScheduleRecord } from '@cairn/shared';
import type { ScheduleRecord as DisplaySchedule } from '../fixtures/records.js';
import type { TFunc } from '../i18n/translate.js';

export type ScheduleTrigger =
  | 'once'
  | 'hourly'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'custom'
  | 'event'
  | 'webhook';

export function isTriggerSchedule(trigger: ScheduleTrigger | string): boolean {
  return trigger === 'event' || trigger === 'webhook';
}
export interface ScheduleDraft {
  trigger: ScheduleTrigger;
  hour: string;
  minute: string;
  date: string;
  cron: string;
  prompt: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

function clockParts(at: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: value('hour'),
    minute: value('minute'),
  };
}

export function scheduleTime(
  date: string,
  hour: string,
  minute: string,
  tz: string,
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}$/.test(hour) || !/^\d{2}$/.test(minute))
    return null;
  const [year, month, day] = date.split('-').map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    Number(hour) > 23 ||
    Number(minute) > 59
  )
    return null;
  const wall = Date.UTC(year, month - 1, day, Number(hour), Number(minute));
  let candidate = wall;
  try {
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const parts = clockParts(candidate, tz);
      const [y, m, d] = parts.date.split('-').map(Number);
      if (y === undefined || m === undefined || d === undefined) return null;
      const rendered = Date.UTC(y, m - 1, d, Number(parts.hour), Number(parts.minute));
      const delta = wall - rendered;
      if (delta === 0) break;
      candidate += delta;
    }
    const actual = clockParts(candidate, tz);
    return actual.date === date && actual.hour === hour && actual.minute === minute
      ? candidate
      : null;
  } catch {
    return null;
  }
}

export function scheduleDraft(
  schedule: ScheduleRecord | null,
  now: number,
  tz = 'UTC',
): ScheduleDraft {
  const clock = clockParts(
    schedule === null ? now : (schedule.at ?? now + 86_400_000),
    schedule?.tz ?? tz,
  );
  if (schedule === null) {
    const [year = 0, month = 0, day = 0] = clock.date.split('-').map(Number);
    clock.date = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  }
  const weekdays =
    schedule?.kind === 'cron' ? /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(schedule.cron ?? '') : null;
  return {
    trigger:
      schedule?.kind === 'cron'
        ? weekdays === null
          ? 'custom'
          : 'weekdays'
        : (schedule?.kind ?? 'daily'),
    ...clock,
    hour: weekdays === null ? (schedule === null ? '09' : clock.hour) : pad(Number(weekdays[2])),
    minute:
      weekdays === null ? (schedule === null ? '00' : clock.minute) : pad(Number(weekdays[1])),
    cron: schedule?.cron ?? '0 9 * * 1-5',
    prompt: schedule?.prompt ?? '',
  };
}

export function cronHasFiveFields(cron: string): boolean {
  return cron.trim().split(/\s+/).length === 5;
}

export function scheduleBody(
  draft: ScheduleDraft,
  schedule: Pick<ScheduleRecord, 'todoId' | 'projectId' | 'tz' | 'enabled'>,
  now: number,
): CreateScheduleBody {
  const base = {
    todoId: schedule.todoId,
    projectId: schedule.projectId,
    tz: schedule.tz,
    prompt: draft.prompt,
    enabled: schedule.enabled,
  };
  if (draft.trigger === 'custom') {
    const cron = draft.cron.trim();
    if (!cronHasFiveFields(cron)) throw new Error('Cron 需要 5 段：分 时 日 月 周。');
    return { ...base, kind: 'cron', cron };
  }
  if (draft.trigger === 'weekdays')
    return { ...base, kind: 'cron', cron: `${Number(draft.minute)} ${Number(draft.hour)} * * 1-5` };
  if (draft.trigger === 'event')
    return { ...base, kind: 'event', triggerSpec: { topic: 'todo.build.completed' } };
  if (draft.trigger === 'webhook') return { ...base, kind: 'webhook' };
  const at = scheduleTime(draft.date, draft.hour, draft.minute, schedule.tz);
  if (at === null) throw new Error('请选择这个时区里有效的日期和时间。');
  if (draft.trigger === 'once' && at <= now) throw new Error('单次定时要选一个将来的时间。');
  return { ...base, kind: draft.trigger, at };
}

export function scheduleViewState(
  schedule: ScheduleRecord,
): 'active' | 'paused' | 'disabled' | 'finished' {
  if (
    schedule.kind === 'once' &&
    schedule.nextRunAt === null &&
    schedule.lastRunAt !== null &&
    schedule.lastRunStatus === 'completed' &&
    schedule.pausedReason === null
  )
    return 'finished';
  if (!schedule.enabled) return schedule.pausedReason === null ? 'paused' : 'disabled';
  return 'active';
}

const PAUSE_REASONS: Record<string, string> = {
  'Task archived': '任务已归档，定时随之停用',
  'Paused by worker': '执行任务的 Agent 暂停了它',
  'Paused after 10 consecutive scheduled runs without a human message':
    '连续 10 次定时运行均无人回复，已自动暂停',
};

export function schedulePauseReason(reason: string, t: TFunc): string {
  const known = PAUSE_REASONS[reason];
  if (known !== undefined) return t(known);
  if (reason.startsWith('git commit failed')) return t('提交代码时被仓库检查拦下，本轮未能完成');
  return /\n|error|failed|exit/i.test(reason) ? t('运行出错，已停用') : reason;
}

export function scheduleEnded(schedule: {
  kind: string;
  enabled?: boolean;
  nextRunAt: number | null;
}): boolean {
  return schedule.kind === 'once' && (schedule.enabled === false || schedule.nextRunAt === null);
}

export function toWireSchedule(schedule: DisplaySchedule): ScheduleRecord {
  return {
    ...schedule,
    cron: schedule.cron ?? null,
    prompt: schedule.prompt ?? '',
    enabled: schedule.enabled ?? true,
    pausedReason: schedule.pausedReason ?? null,
    lastRunAt: schedule.lastRunAt ?? null,
    lastRunStatus: schedule.lastRunStatus ?? null,
    lastRunError: schedule.lastRunError ?? null,
    triggerSpec: schedule.triggerSpec ?? null,
    webhookMasked: schedule.webhookMasked ?? null,
    webhookLastUsedAt: schedule.webhookLastUsedAt ?? null,
    missedRunWindowMs: schedule.missedRunWindowMs ?? null,
    createdAt: schedule.createdAt ?? null,
  };
}
