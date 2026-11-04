import type { ScheduleRecord } from '@cairn/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { build, schedule, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { type BuildDeps, sendBuildSteer, startBuilds, toBuildRecord } from './builds.js';
import { projectOfTodo } from './git.js';
import {
  ARCHIVED_SCHEDULE_PAUSE_REASON,
  assertWorkerScheduleInterval,
  computeNextRunAt,
  isRecurring,
  isWorkerSchedule,
  pauseSchedule,
  toScheduleRecord,
  updateNextRunAt,
  WORKER_SCHEDULE_MIN_INTERVAL_MS,
  WORKER_SCHEDULE_RUN_LIMIT,
  workerScheduleRunHistory,
} from './schedules.js';
import { insertMessageRow } from './transcript.js';

type ScheduleRow = typeof schedule.$inferSelect;
type TodoRow = typeof todo.$inferSelect;

export const SCHEDULE_GATE_PHASES = new Set(['confirm', 'review']);

export async function fireSchedule(deps: BuildDeps, row: ScheduleRow, now: number): Promise<void> {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  const projectRow = todoRow ? projectOfTodo(deps.db, todoRow) : undefined;
  if (!todoRow || todoRow.projectId !== row.projectId || !projectRow) {
    deps.db.delete(schedule).where(eq(schedule.id, row.id)).run();
    return;
  }
  if (todoRow.archivedAt !== null) {
    pauseSchedule(deps, row.id, ARCHIVED_SCHEDULE_PAUSE_REASON);
    return;
  }
  const workerCreated = isWorkerSchedule(row.createdBy);
  if (workerCreated) {
    const history = workerScheduleRunHistory(deps, row.todoId);
    if (history.consecutive >= WORKER_SCHEDULE_RUN_LIMIT) {
      pauseSchedule(
        deps,
        row.id,
        'Paused after 10 consecutive scheduled runs without a human message',
      );
      return;
    }
    if (SCHEDULE_GATE_PHASES.has(todoRow.phase)) {
      try {
        const next = isRecurring(row.kind)
          ? computeNextRunAt(row.kind, row.at, row.tz, now, row.cron)
          : now + WORKER_SCHEDULE_MIN_INTERVAL_MS;
        updateNextRunAt(deps, row.id, next);
      } catch (err) {
        pauseSchedule(deps, row.id, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    try {
      assertWorkerScheduleInterval(row, now, false);
    } catch (err) {
      pauseSchedule(deps, row.id, err instanceof Error ? err.message : String(err));
      return;
    }
    if (history.lastRunAt !== null && now - history.lastRunAt < WORKER_SCHEDULE_MIN_INTERVAL_MS) {
      updateNextRunAt(deps, row.id, history.lastRunAt + WORKER_SCHEDULE_MIN_INTERVAL_MS);
      return;
    }
  }
  let nextRunAt: number | null = row.nextRunAt;
  if (isRecurring(row.kind)) {
    try {
      nextRunAt = computeNextRunAt(row.kind, row.at, row.tz, now, row.cron);
    } catch (err) {
      pauseSchedule(deps, row.id, err instanceof Error ? err.message : String(err));
      return;
    }
  }
  if (hasActiveStep(deps, todoRow)) {
    if (isRecurring(row.kind)) updateNextRunAt(deps, row.id, nextRunAt);
    return;
  }
  await dispatchScheduleRun(deps, row, todoRow, now);
  updateNextRunAt(deps, row.id, isRecurring(row.kind) ? nextRunAt : null);
}

function hasActiveStep(deps: BuildDeps, todoRow: TodoRow): boolean {
  if (todoRow.latestBuildId === null) return false;
  return (
    deps.db
      .select({ id: step.id })
      .from(step)
      .where(
        and(
          eq(step.buildId, todoRow.latestBuildId),
          inArray(step.status, ['pending', 'claimed', 'waiting_quota']),
        ),
      )
      .get() !== undefined
  );
}

async function dispatchScheduleRun(
  deps: BuildDeps,
  row: ScheduleRow,
  todoRow: TodoRow,
  now: number,
  manual = false,
): Promise<void> {
  const workerCreated = isWorkerSchedule(row.createdBy);
  const prompt = workerCreated
    ? `Scheduled follow-up you set earlier:\n\n${row.prompt}`
    : row.prompt || 'Continue this task.';
  let buildId = todoRow.latestBuildId;
  const freshAtConfirm = !workerCreated && todoRow.phase === 'confirm';
  if (buildId !== null && !freshAtConfirm) {
    await sendBuildSteer(
      deps,
      buildId,
      { content: prompt },
      {
        afterTurn: true,
        human: false,
        schedule: { id: row.id, createdBy: row.createdBy, at: now, manual },
      },
    );
  } else {
    if (freshAtConfirm && buildId !== null) {
      deps.db.update(build).set({ errorMessage: 'Cancelled' }).where(eq(build.id, buildId)).run();
      const cancelled = deps.db.select().from(build).where(eq(build.id, buildId)).get();
      if (cancelled) deps.hub.publishBuildDoc(todoRow.teamId, toBuildRecord(cancelled));
    }
    const [started] = startBuilds(deps, {
      projectId: row.projectId,
      todoIds: [row.todoId],
      assignment: todoRow.assignment ?? { plan: null, build: null },
      withPlan: false,
      triggerSource: 'schedule',
      scheduledBy: row.createdBy,
      prompt: workerCreated ? prompt : row.prompt || undefined,
    });
    buildId = started?.id ?? null;
  }
  const fired =
    buildId === null
      ? undefined
      : deps.db
          .select()
          .from(step)
          .where(and(eq(step.buildId, buildId), eq(step.status, 'pending')))
          .orderBy(desc(step.createdAt))
          .get();
  if (!fired) throw new Error('Scheduled continuation did not enqueue a step');
  deps.db.update(step).set({ scheduleId: row.id }).where(eq(step.id, fired.id)).run();
  if (todoRow.latestBuildId === null || freshAtConfirm) {
    insertMessageRow(deps, fired.buildId, {
      id: `schedule-wake-${fired.id}`,
      role: 'system',
      content: JSON.stringify({ kind: 'schedule-wake', stepId: fired.id }),
      createdAt: fired.createdAt,
    });
  }
  deps.db
    .update(schedule)
    .set({
      lastRunAt: now,
      lastRunStatus: 'started',
      lastRunError: null,
      retryNotBefore: null,
      lastRunStepId: fired.id,
    })
    .where(eq(schedule.id, row.id))
    .run();
}

const firingSchedules = new Set<string>();

export async function fireDueSchedule(
  deps: BuildDeps,
  row: ScheduleRow,
  now: number,
): Promise<void> {
  await guardedFire(row.id, () => fireSchedule(deps, row, now), false);
}

async function guardedFire(
  id: string,
  run: () => Promise<void>,
  rejectIfBusy: boolean,
): Promise<void> {
  if (firingSchedules.has(id)) {
    if (rejectIfBusy) throw new HttpError(409, 'This schedule is already running');
    return;
  }
  firingSchedules.add(id);
  try {
    await run();
  } finally {
    firingSchedules.delete(id);
  }
}

export async function runScheduleNow(
  deps: BuildDeps,
  teamId: string,
  id: string,
): Promise<ScheduleRecord> {
  const row = deps.db.select().from(schedule).where(eq(schedule.id, id)).get();
  if (!row || row.teamId !== teamId) throw new HttpError(404, `schedule ${id} not found`);
  await guardedFire(
    id,
    async () => {
      const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
      if (!todoRow || todoRow.projectId !== row.projectId || !projectOfTodo(deps.db, todoRow)) {
        throw new HttpError(404, `schedule ${id} not found`);
      }
      if (todoRow.archivedAt !== null) {
        throw new HttpError(409, 'This schedule belongs to an archived thread');
      }
      if (isWorkerSchedule(row.createdBy) && SCHEDULE_GATE_PHASES.has(todoRow.phase)) {
        throw new HttpError(409, 'This thread is waiting at a confirmation or review gate');
      }
      if (hasActiveStep(deps, todoRow)) {
        throw new HttpError(409, 'This thread is already running');
      }
      await dispatchScheduleRun(deps, row, todoRow, nowMs(), true);
      if (row.kind === 'once' && row.enabled) updateNextRunAt(deps, row.id, null);
    },
    true,
  );
  const current = deps.db.select().from(schedule).where(eq(schedule.id, id)).get();
  const record = current ? toScheduleRecord(deps, current) : null;
  if (!record) throw new HttpError(404, `schedule ${id} not found`);
  return record;
}
