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
  weekday: number;
  cron: string;
  prompt: string;
}

export type CronPreviewResult = { ok: true; nextRunAt: number } | { ok: false; errorKey: string };

const pad = (value: number) => String(value).padStart(2, '0');

const DOW_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const MONTH_NAMES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const WEEKDAY_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

function clockParts(at: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: value('hour'),
    minute: value('minute'),
    weekday: DOW_INDEX[value('weekday')] ?? 0,
  };
}

function shiftCivilDate(date: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  if (Number.isNaN(shifted.getTime())) return null;
  return shifted.toISOString().slice(0, 10);
}

function civilDateWeekday(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
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

function recurringAnchorTime(
  trigger: 'hourly' | 'daily' | 'weekly',
  draft: ScheduleDraft,
  tz: string,
): number | null {
  if (trigger === 'weekly') {
    const baseDow = civilDateWeekday(draft.date);
    if (baseDow === null) return null;
    const targetDow = ((draft.weekday % 7) + 7) % 7;
    const offset = (targetDow - baseDow + 7) % 7;
    for (let week = 0; week < 6; week += 1) {
      const candidateDate = shiftCivilDate(draft.date, offset + week * 7);
      if (candidateDate === null) return null;
      const resolved = scheduleTime(candidateDate, draft.hour, draft.minute, tz);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const candidateDate = shiftCivilDate(draft.date, dayOffset);
    if (candidateDate === null) return null;
    const resolved = scheduleTime(candidateDate, draft.hour, draft.minute, tz);
    if (resolved !== null) return resolved;
  }
  if (trigger === 'hourly') {
    return scheduleTime(draft.date, '12', draft.minute, tz);
  }
  return null;
}

function parseCronToken(
  token: string,
  min: number,
  max: number,
  names?: Record<string, number>,
): number | null {
  const upper = token.toUpperCase();
  if (names !== undefined && upper in names) return names[upper] ?? null;
  if (!/^\d+$/.test(token)) return null;
  const parsed = Number.parseInt(token, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  errorKey: string,
  names?: Record<string, number>,
  wrapSevenToZero = false,
): { ok: true; values: Set<number>; wildcard: boolean } | { ok: false; errorKey: string } {
  const values = new Set<number>();
  const add = (value: number) => {
    values.add(wrapSevenToZero && value === 7 ? 0 : value);
  };
  if (field === '*') {
    for (let value = min; value <= max; value += 1) add(value);
    return { ok: true, values, wildcard: true };
  }
  const parts = field.split(',');
  for (const part of parts) {
    if (part === '') return { ok: false, errorKey };
    const slashParts = part.split('/');
    if (slashParts.length > 2) return { ok: false, errorKey };
    const [base, stepRaw] = slashParts;
    if (base === undefined || base === '') return { ok: false, errorKey };
    let step = 1;
    if (stepRaw !== undefined) {
      if (!/^[1-9]\d*$/.test(stepRaw)) return { ok: false, errorKey };
      step = Number.parseInt(stepRaw, 10);
    }
    let start: number;
    let end: number;
    if (base === '*') {
      start = min;
      end = max;
    } else if (base.includes('-')) {
      const rangeParts = base.split('-');
      if (rangeParts.length !== 2) return { ok: false, errorKey };
      const parsedStart = parseCronToken(rangeParts[0] ?? '', min, max, names);
      const parsedEnd = parseCronToken(rangeParts[1] ?? '', min, max, names);
      if (parsedStart === null || parsedEnd === null || parsedStart > parsedEnd) {
        return { ok: false, errorKey };
      }
      start = parsedStart;
      end = parsedEnd;
    } else {
      const parsed = parseCronToken(base, min, max, names);
      if (parsed === null) return { ok: false, errorKey };
      start = parsed;
      end = stepRaw !== undefined ? max : parsed;
    }
    for (let value = start; value <= end; value += step) add(value);
  }
  if (values.size === 0) return { ok: false, errorKey };
  return { ok: true, values, wildcard: false };
}

function nextInSorted(sorted: readonly number[], afterOrEqual: number): number | null {
  for (const value of sorted) {
    if (value >= afterOrEqual) return value;
  }
  return null;
}

export function previewCronNextRun(cron: string, tz: string, fromMs: number): CronPreviewResult {
  const fields = cron.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) {
    return { ok: false, errorKey: 'Cron 需要 5 段：分 时 日 月 周。' };
  }
  const minuteField = parseCronField(fields[0] ?? '', 0, 59, '分钟段只能填 0–59 的数值或表达式。');
  if (!minuteField.ok) return minuteField;
  const hourField = parseCronField(fields[1] ?? '', 0, 23, '小时段只能填 0–23 的数值或表达式。');
  if (!hourField.ok) return hourField;
  const domField = parseCronField(fields[2] ?? '', 1, 31, '日期段只能填 1–31 的数值或表达式。');
  if (!domField.ok) return domField;
  const monthField = parseCronField(
    fields[3] ?? '',
    1,
    12,
    '月份段只能填 1–12 或 JAN–DEC。',
    MONTH_NAMES,
  );
  if (!monthField.ok) return monthField;
  const dowField = parseCronField(
    fields[4] ?? '',
    0,
    7,
    '星期段只能填 0–7 或 SUN–SAT。',
    WEEKDAY_NAMES,
    true,
  );
  if (!dowField.ok) return dowField;

  const minutes = [...minuteField.values].sort((a, b) => a - b);
  const hours = [...hourField.values].sort((a, b) => a - b);
  const months = [...monthField.values].sort((a, b) => a - b);
  const startAt = Math.floor(fromMs / 60_000) * 60_000 + 60_000;
  let startParts: ReturnType<typeof clockParts>;
  try {
    startParts = clockParts(startAt, tz);
  } catch {
    return { ok: false, errorKey: '时区设置无效，请检查后重试。' };
  }
  const [startYear, startMonth, startDay] = startParts.date.split('-').map(Number);
  if (startYear === undefined || startMonth === undefined || startDay === undefined) {
    return { ok: false, errorKey: '时区设置无效，请检查后重试。' };
  }
  let year = startYear;
  let month = startMonth;
  let day = startDay;
  let hour = Number(startParts.hour);
  let minute = Number(startParts.minute);
  const maxYear = startYear + 4;

  const advanceDay = () => {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
    hour = 0;
    minute = 0;
  };

  while (year <= maxYear) {
    if (!monthField.values.has(month)) {
      const nextMonth = nextInSorted(months, month + 1);
      if (nextMonth !== null) {
        month = nextMonth;
      } else {
        year += 1;
        month = months[0] ?? 1;
      }
      day = 1;
      hour = 0;
      minute = 0;
      continue;
    }
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const dayMatches =
      domField.wildcard && dowField.wildcard
        ? true
        : domField.wildcard
          ? dowField.values.has(dow)
          : dowField.wildcard
            ? domField.values.has(day)
            : domField.values.has(day) || dowField.values.has(dow);
    if (!dayMatches) {
      advanceDay();
      continue;
    }
    const matchedHour = nextInSorted(hours, hour);
    if (matchedHour === null) {
      advanceDay();
      continue;
    }
    if (matchedHour !== hour) {
      hour = matchedHour;
      minute = 0;
    }
    const matchedMinute = nextInSorted(minutes, minute);
    if (matchedMinute === null) {
      hour += 1;
      minute = 0;
      if (hour > 23) advanceDay();
      continue;
    }
    minute = matchedMinute;
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const resolved = scheduleTime(dateStr, pad(hour), pad(minute), tz);
    if (resolved !== null && resolved > fromMs) {
      return { ok: true, nextRunAt: resolved };
    }
    minute += 1;
    if (minute > 59) {
      hour += 1;
      minute = 0;
      if (hour > 23) advanceDay();
    }
  }
  return { ok: false, errorKey: '这个 Cron 表达式不会匹配任何有效日期。' };
}

export function scheduleDraft(
  schedule: ScheduleRecord | null,
  now: number,
  tz = 'UTC',
): ScheduleDraft {
  const zone = schedule?.tz ?? tz;
  const clock = clockParts(schedule === null ? now : (schedule.at ?? now + 86_400_000), zone);
  if (schedule === null) {
    const nextDate = shiftCivilDate(clock.date, 1);
    if (nextDate !== null) clock.date = nextDate;
  }
  const weekdays =
    schedule?.kind === 'cron' ? /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(schedule.cron ?? '') : null;
  const weeklyCronDow =
    schedule?.kind === 'weekly' && schedule.at === null
      ? /^\d{1,2} \d{1,2} \* \* ([0-7])$/.exec(schedule.cron ?? '')
      : null;
  const hasAnchor = schedule !== null && schedule.at !== null;
  const weekday =
    weeklyCronDow !== null
      ? Number(weeklyCronDow[1]) % 7
      : hasAnchor
        ? clock.weekday
        : (civilDateWeekday(clock.date) ?? clock.weekday);
  return {
    trigger:
      schedule?.kind === 'cron'
        ? weekdays === null
          ? 'custom'
          : 'weekdays'
        : (schedule?.kind ?? 'daily'),
    date: clock.date,
    weekday,
    hour: weekdays === null ? (hasAnchor ? clock.hour : '09') : pad(Number(weekdays[2])),
    minute: weekdays === null ? (hasAnchor ? clock.minute : '00') : pad(Number(weekdays[1])),
    cron: schedule?.cron ?? '0 9 * * 1-5',
    prompt: schedule?.prompt ?? '',
  };
}

export function cronHasFiveFields(cron: string): boolean {
  return cron.trim().split(/\s+/).filter(Boolean).length === 5;
}

export const SCHEDULE_VALIDATION_ERROR_KEYS: ReadonlySet<string> = new Set([
  'Cron 需要 5 段：分 时 日 月 周。',
  '分钟段只能填 0–59 的数值或表达式。',
  '小时段只能填 0–23 的数值或表达式。',
  '日期段只能填 1–31 的数值或表达式。',
  '月份段只能填 1–12 或 JAN–DEC。',
  '星期段只能填 0–7 或 SUN–SAT。',
  '这个 Cron 表达式不会匹配任何有效日期。',
  '时区设置无效，请检查后重试。',
  '请选择这个时区里有效的日期和时间。',
  '单次定时要选一个将来的时间。',
]);

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
    const preview = previewCronNextRun(cron, schedule.tz, now);
    if (!preview.ok) throw new Error(preview.errorKey);
    return { ...base, kind: 'cron', cron };
  }
  if (draft.trigger === 'weekdays')
    return { ...base, kind: 'cron', cron: `${Number(draft.minute)} ${Number(draft.hour)} * * 1-5` };
  if (draft.trigger === 'event')
    return { ...base, kind: 'event', triggerSpec: { topic: 'todo.build.completed' } };
  if (draft.trigger === 'webhook') return { ...base, kind: 'webhook' };
  const at =
    draft.trigger === 'once'
      ? scheduleTime(draft.date, draft.hour, draft.minute, schedule.tz)
      : recurringAnchorTime(draft.trigger, draft, schedule.tz);
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
  'Project archived': '项目已归档，定时随之停用',
  'Task is waiting for plan confirmation': '任务正在等待确认方案，本轮定时已跳过',
  'Task is waiting for user answer': '任务正在等待回复，本轮定时已跳过',
  'missed the run window': '错过运行窗口，本轮定时已跳过',
  'Paused by worker': '执行任务的步骤暂停了它',
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
  lastRunAt?: number | null;
  lastRunStatus?: string | null;
  pausedReason?: string | null;
}): boolean {
  if (schedule.kind !== 'once') return false;
  if (schedule.nextRunAt !== null && schedule.nextRunAt !== 0) return false;
  if (schedule.enabled === false) {
    if (schedule.pausedReason != null) return true;
    return (
      schedule.lastRunAt != null ||
      (schedule.lastRunStatus != null && schedule.lastRunStatus !== '')
    );
  }
  return true;
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
