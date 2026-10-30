import type { CreateScheduleBody, ScheduleKind, ScheduleRecord } from '@cairn/shared';
import { SCHEDULE_MINUTE_STEPS } from '@cairn/shared';
import { CronExpressionParser } from 'cron-parser';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { schedule, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { TeamStreamHub } from './events.js';
import { projectOfTodo } from './git.js';

export interface ScheduleDeps {
  db: Db;
  hub: TeamStreamHub;
}

type ScheduleRow = typeof schedule.$inferSelect;

export function serverTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function wallClockParts(
  atMs: number,
  tz: string,
): { minute: number; hour: number; dow: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    minute: 'numeric',
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(atMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number.parseInt(get('hour'), 10) % 24;
  return { minute: Number.parseInt(get('minute'), 10), hour, dow: DOW[get('weekday')] ?? 0 };
}

export function assertMinuteStep(atMs: number, tz: string): void {
  const { minute } = wallClockParts(atMs, tz);
  if (!(SCHEDULE_MINUTE_STEPS as readonly number[]).includes(minute)) {
    throw new HttpError(
      400,
      `invalid schedule minute: ${minute} (allowed steps: ${SCHEDULE_MINUTE_STEPS.join('/')})`,
    );
  }
}

export function isRecurring(kind: ScheduleKind): kind is Exclude<ScheduleKind, 'once'> {
  return kind !== 'once';
}

export function cronExpressionFor(
  kind: ScheduleKind,
  atMs: number | null,
  tz: string,
  cron: string | null = null,
): string | null {
  if (!isRecurring(kind)) return null;
  if (kind === 'cron') return cron;
  if (atMs === null) throw new HttpError(400, 'missing schedule anchor');
  const { minute, hour, dow } = wallClockParts(atMs, tz);
  switch (kind) {
    case 'hourly':
      return `${minute} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${dow}`;
  }
}

export function computeNextRunAt(
  kind: ScheduleKind,
  atMs: number | null,
  tz: string,
  fromMs: number,
  cron: string | null = null,
): number {
  if (!isRecurring(kind)) {
    if (atMs === null) throw new HttpError(400, 'missing schedule anchor');
    return atMs;
  }
  const expr = cronExpressionFor(kind, atMs, tz, cron);
  if (expr === null) throw new HttpError(400, 'missing schedule cron expression');
  try {
    return CronExpressionParser.parse(expr, { tz, currentDate: new Date(fromMs) })
      .next()
      .getTime();
  } catch {
    throw new HttpError(400, 'invalid schedule cron expression or timezone');
  }
}

export function toScheduleRecord(deps: ScheduleDeps, row: ScheduleRow): ScheduleRecord | null {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow) return null;
  const projectRow = projectOfTodo(deps.db, todoRow);
  return {
    id: row.id,
    teamId: row.teamId,
    projectId: row.projectId,
    todoId: row.todoId,
    kind: row.kind,
    cron: row.cron,
    prompt: row.prompt,
    enabled: row.enabled,
    at: row.at,
    tz: row.tz,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastRunStatus: row.lastRunStatus,
    pausedReason: row.pausedReason,
    createdBy: row.createdBy,
    todo: {
      seqNum: todoRow.seqNum,
      title: todoRow.title,
      phase: todoRow.phase,
      projectName: projectRow?.name ?? '',
      ownerId: todoRow.ownerId ?? todoRow.createdBy ?? '',
    },
  };
}

export function listSchedules(deps: ScheduleDeps, teamId: string): ScheduleRecord[] {
  return deps.db
    .select()
    .from(schedule)
    .where(eq(schedule.teamId, teamId))
    .all()
    .map((row) => toScheduleRecord(deps, row))
    .filter((r): r is ScheduleRecord => r !== null);
}

export function createSchedule(
  deps: ScheduleDeps,
  input: CreateScheduleBody & { teamId: string; createdBy: string },
): ScheduleRecord {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, input.todoId)).get();
  if (!todoRow || todoRow.teamId !== input.teamId) {
    throw new HttpError(404, `todo ${input.todoId} not found`);
  }
  const projectId = input.projectId ?? todoRow.projectId;
  if (projectId !== todoRow.projectId) {
    throw new HttpError(400, 'invalid projectId: todo belongs to another project');
  }
  const tz = input.tz ?? serverTimezone();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format();
  } catch {
    throw new HttpError(400, 'invalid schedule timezone');
  }
  if (input.kind === 'once') assertMinuteStep(input.at, tz);
  const now = nowMs();
  const id = newRecordId();
  const at = input.at ?? null;
  const cron = cronExpressionFor(input.kind, at, tz, input.cron ?? null);
  const nextRunAt = computeNextRunAt(input.kind, at, tz, now, cron);
  const values = {
    id,
    teamId: input.teamId,
    projectId,
    todoId: input.todoId,
    kind: input.kind,
    at,
    cron,
    prompt: input.prompt ?? '',
    enabled: input.enabled ?? true,
    tz,
    nextRunAt,
    lastRunAt: null,
    lastRunStatus: null,
    pausedReason: null,
    createdBy: input.createdBy,
  };
  deps.db
    .insert(schedule)
    .values(values)
    .onConflictDoUpdate({ target: schedule.todoId, set: values })
    .run();
  const row = deps.db.select().from(schedule).where(eq(schedule.id, id)).get();
  const record = row ? toScheduleRecord(deps, row) : null;
  if (!record) throw new Error('schedule missing after insert');
  return record;
}

export function deleteSchedule(deps: ScheduleDeps, id: string): boolean {
  const row = deps.db.select().from(schedule).where(eq(schedule.id, id)).get();
  if (!row) return false;
  deps.db.delete(schedule).where(eq(schedule.id, id)).run();
  return true;
}

export function dueSchedules(deps: ScheduleDeps, nowMsValue: number): ScheduleRow[] {
  return deps.db
    .select()
    .from(schedule)
    .where(
      and(
        eq(schedule.enabled, true),
        isNotNull(schedule.nextRunAt),
        lte(schedule.nextRunAt, nowMsValue),
      ),
    )
    .all();
}

export function updateNextRunAt(deps: ScheduleDeps, id: string, nextRunAt: number | null): void {
  deps.db.update(schedule).set({ nextRunAt }).where(eq(schedule.id, id)).run();
}

export function pauseSchedule(deps: ScheduleDeps, id: string, reason: string): void {
  deps.db
    .update(schedule)
    .set({ enabled: false, nextRunAt: null, pausedReason: reason })
    .where(eq(schedule.id, id))
    .run();
}

export const ARCHIVED_SCHEDULE_PAUSE_REASON = 'Task archived';

export function pauseTodoSchedule(deps: ScheduleDeps, todoId: string, reason: string): void {
  deps.db
    .update(schedule)
    .set({ enabled: false, nextRunAt: null, pausedReason: reason })
    .where(eq(schedule.todoId, todoId))
    .run();
}
