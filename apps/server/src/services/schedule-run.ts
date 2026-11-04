import type { ScheduleRecord } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { schedule, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { hasActiveStep } from './builds.js';
import { toScheduleRecord } from './schedules.js';

export function runScheduleNow(deps: BuildDeps, teamId: string, id: string): ScheduleRecord {
  const row = deps.db.select().from(schedule).where(eq(schedule.id, id)).get();
  if (!row || row.teamId !== teamId) throw new HttpError(404, `schedule ${id} not found`);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow) throw new HttpError(404, `schedule ${id} not found`);
  if (todoRow.archivedAt !== null) {
    throw new HttpError(409, 'This schedule belongs to an archived thread');
  }
  if (!row.enabled) throw new HttpError(409, 'This schedule is paused; resume it first');
  if (todoRow.latestBuildId !== null && hasActiveStep(deps, todoRow.latestBuildId)) {
    throw new HttpError(409, 'This thread is already running');
  }
  const now = nowMs();
  if (row.nextRunAt !== null && row.nextRunAt <= now && row.retryNotBefore === null) {
    throw new HttpError(409, 'This schedule is already queued to run');
  }
  deps.db
    .update(schedule)
    .set({ nextRunAt: now, retryNotBefore: null })
    .where(eq(schedule.id, id))
    .run();
  const current = deps.db.select().from(schedule).where(eq(schedule.id, id)).get();
  const record = current ? toScheduleRecord(deps, current) : null;
  if (!record) throw new HttpError(404, `schedule ${id} not found`);
  return record;
}
