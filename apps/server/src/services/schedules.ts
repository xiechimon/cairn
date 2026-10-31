import type { CreateScheduleBody, ScheduleKind, ScheduleRecord, UserRecord } from '@cairn/shared';
import { classifyStepFailure, isProviderOutage, SCHEDULE_MINUTE_STEPS } from '@cairn/shared';
import { CronExpressionParser } from 'cron-parser';
import { and, desc, eq, isNotNull, isNull, like, lte, max, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, message, schedule, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { TeamStreamHub } from './events.js';
import { projectOfTodo } from './git.js';
import { notifyScheduleRun } from './notifications.js';

export interface ScheduleDeps {
  db: Db;
  hub: TeamStreamHub;
}

type ScheduleRow = typeof schedule.$inferSelect;

export const WORKER_SCHEDULE_MIN_INTERVAL_MS = 15 * 60_000;
export const WORKER_SCHEDULE_RUN_LIMIT = 10;

export function isWorkerSchedule(createdBy: string): boolean {
  return createdBy.startsWith('worker:');
}

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
    lastRunError: row.lastRunError,
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
  options: { allowAnyMinute?: boolean } = {},
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
  if (input.kind === 'once' && !options.allowAnyMinute) assertMinuteStep(input.at, tz);
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
    lastRunError: null,
    lastRunStepId: null,
    retryNotBefore: null,
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
        or(isNull(schedule.retryNotBefore), lte(schedule.retryNotBefore, nowMsValue)),
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

export function parseThreadCadence(
  cadence: string,
  fromMs = nowMs(),
): { kind: 'once'; at: number } | { kind: 'cron'; cron: string; at: null } {
  const relative = /^in ([1-9]\d*) (seconds?|minutes?|hours?|days?)$/.exec(cadence);
  if (relative) {
    const units: Record<string, number> = {
      second: 1000,
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
    };
    const unit = relative[2]?.replace(/s$/, '') ?? '';
    const at = fromMs + Number(relative[1]) * (units[unit] ?? 0);
    if (!Number.isSafeInteger(at) || at > 8_640_000_000_000_000) {
      throw new HttpError(400, 'invalid schedule delay');
    }
    assertWorkerScheduleInterval({ kind: 'once', at, tz: serverTimezone(), cron: null }, fromMs);
    return { kind: 'once', at };
  }
  if (cadence.startsWith('at ')) {
    const timestamp = cadence.slice(3);
    const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      timestamp,
    )
      ? Date.parse(timestamp)
      : Number.NaN;
    const wallClock = Date.parse(`${timestamp.slice(0, 19)}Z`);
    if (
      !Number.isSafeInteger(at) ||
      at <= fromMs ||
      !Number.isSafeInteger(wallClock) ||
      new Date(wallClock).toISOString().slice(0, 19) !== timestamp.slice(0, 19)
    ) {
      throw new HttpError(400, 'invalid schedule timestamp: expected a future ISO timestamp');
    }
    assertWorkerScheduleInterval({ kind: 'once', at, tz: serverTimezone(), cron: null }, fromMs);
    return { kind: 'once', at };
  }
  if (cadence.split(/\s+/).length !== 5) {
    throw new HttpError(
      400,
      'invalid schedule cadence: expected a delay, ISO timestamp or five-field cron',
    );
  }
  assertWorkerScheduleInterval(
    { kind: 'cron', at: null, tz: serverTimezone(), cron: cadence },
    fromMs,
  );
  return { kind: 'cron', cron: cadence, at: null };
}

export function assertWorkerScheduleInterval(
  cadence: Pick<ScheduleRow, 'kind' | 'at' | 'tz' | 'cron'>,
  fromMs: number,
  checkOnce = true,
): void {
  const first = computeNextRunAt(cadence.kind, cadence.at, cadence.tz, fromMs, cadence.cron);
  if (cadence.kind === 'once') {
    if (checkOnce && first - fromMs < WORKER_SCHEDULE_MIN_INTERVAL_MS) {
      throw new HttpError(400, 'worker schedules require an interval of at least 15 minutes');
    }
    return;
  }
  const expression = cronExpressionFor(cadence.kind, cadence.at, cadence.tz, cadence.cron);
  if (expression === null) throw new HttpError(400, 'missing schedule cron expression');
  try {
    const dayMs = 24 * 60 * 60_000;
    const fires = CronExpressionParser.parse(expression, {
      tz: cadence.tz,
      currentDate: new Date(first - dayMs),
    });
    let previous = fires.next().getTime();
    while (previous <= first + dayMs) {
      const next = fires.next().getTime();
      if (next - previous < WORKER_SCHEDULE_MIN_INTERVAL_MS) {
        throw new HttpError(400, 'worker schedules require an interval of at least 15 minutes');
      }
      previous = next;
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'invalid schedule cron expression or timezone');
  }
}

export function workerScheduleRunHistory(
  deps: ScheduleDeps,
  todoId: string,
): { consecutive: number; lastRunAt: number | null } {
  const lastHuman =
    deps.db
      .select({ at: max(message.createdAt) })
      .from(message)
      .innerJoin(build, eq(message.conversationId, build.id))
      .where(
        and(
          eq(build.todoId, todoId),
          eq(message.role, 'user'),
          like(message.id, 'human-%'),
          isNotNull(message.actor),
        ),
      )
      .get()?.at ?? null;
  const legacy = deps.db
    .select()
    .from(build)
    .where(and(eq(build.todoId, todoId), eq(build.triggerSource, 'schedule')))
    .orderBy(desc(build.createdAt), desc(build.id))
    .limit(WORKER_SCHEDULE_RUN_LIMIT)
    .all();
  const continued = deps.db
    .select({ createdAt: step.createdAt })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .where(and(eq(build.todoId, todoId), isNotNull(step.scheduledBy)))
    .orderBy(desc(step.createdAt), desc(step.id))
    .limit(WORKER_SCHEDULE_RUN_LIMIT)
    .all();
  const recent = [...legacy, ...continued].sort((a, b) => b.createdAt - a.createdAt);
  let consecutive = 0;
  for (const row of recent) {
    if (lastHuman !== null && row.createdAt <= lastHuman) break;
    consecutive++;
  }
  return {
    consecutive,
    lastRunAt: recent[0]?.createdAt ?? null,
  };
}

export function scheduleFailureIsTransient(reason: string): boolean {
  return (
    ['network', 'capacity', 'quota'].includes(classifyStepFailure(reason)) ||
    isProviderOutage(reason) ||
    /^Could not read PR #/.test(reason)
  );
}

export function recordScheduleFailure(
  deps: ScheduleDeps,
  id: string,
  reason: string,
  at = nowMs(),
): void {
  deps.db
    .update(schedule)
    .set({
      lastRunStatus: 'failed',
      lastRunError: reason,
      retryNotBefore: scheduleFailureIsTransient(reason) ? at + 5 * 60_000 : null,
    })
    .where(eq(schedule.id, id))
    .run();
  if (!scheduleFailureIsTransient(reason)) pauseSchedule(deps, id, reason);
}

export function finishScheduledStep(
  deps: ScheduleDeps & { user: UserRecord },
  stepRow: typeof step.$inferSelect,
  outcome: { status: 'completed' | 'stopped' } | { status: 'failed'; error: string } = {
    status: 'completed',
  },
): void {
  if (stepRow.scheduleId === null) return;
  const row = deps.db
    .select()
    .from(schedule)
    .where(and(eq(schedule.id, stepRow.scheduleId), eq(schedule.lastRunStepId, stepRow.id)))
    .get();
  if (!row) return;
  if (outcome.status !== 'stopped') {
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
    if (todoRow) {
      notifyScheduleRun(
        deps,
        todoRow,
        outcome.status === 'failed' ? `Scheduled run failed: ${outcome.error}` : null,
      );
    }
  }
  if (outcome.status === 'failed') {
    recordScheduleFailure(deps, row.id, outcome.error);
    return;
  }
  if (outcome.status === 'completed' && row.kind === 'once' && row.enabled) {
    deps.db.delete(schedule).where(eq(schedule.id, row.id)).run();
    return;
  }
  deps.db
    .update(schedule)
    .set({ lastRunStatus: outcome.status, lastRunError: null, retryNotBefore: null })
    .where(eq(schedule.id, row.id))
    .run();
}
