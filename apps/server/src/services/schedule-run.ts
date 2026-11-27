import { isChiefSideThreadId, type ScheduleRecord } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { chiefThread, project, schedule, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { hasActiveStep } from './builds.js';
import { clearScheduleDueEvent, notifyScheduleClock, toScheduleRecord } from './schedules.js';

export function runScheduleNow(deps: BuildDeps, teamId: string, id: string): ScheduleRecord {
  const record = deps.db.transaction(
    (tx) => {
      const txDeps = { ...deps, db: tx };
      const row = tx.select().from(schedule).where(eq(schedule.id, id)).get();
      if (!row || row.teamId !== teamId) throw new HttpError(404, `schedule ${id} not found`);
      let activeTargetId: string | null = null;
      if (row.chiefThreadId !== null) {
        const threadRow = tx
          .select()
          .from(chiefThread)
          .where(eq(chiefThread.id, row.chiefThreadId))
          .get();
        if (!threadRow || threadRow.teamId !== teamId || isChiefSideThreadId(threadRow.id)) {
          throw new HttpError(404, `schedule ${id} not found`);
        }
        if (threadRow.archivedAt !== null) {
          throw new HttpError(409, 'This schedule belongs to an archived thread');
        }
        if (threadRow.projectId !== null) {
          const projectRow = tx
            .select()
            .from(project)
            .where(eq(project.id, threadRow.projectId))
            .get();
          if (!projectRow || projectRow.teamId !== teamId) {
            throw new HttpError(404, `schedule ${id} not found`);
          }
          if (projectRow.archivedAt !== null) {
            throw new HttpError(409, 'This schedule belongs to an archived project');
          }
        }
        activeTargetId = threadRow.id;
      } else if (row.todoId !== null) {
        const todoRow = tx.select().from(todo).where(eq(todo.id, row.todoId)).get();
        if (!todoRow || todoRow.teamId !== teamId) {
          throw new HttpError(404, `schedule ${id} not found`);
        }
        if (todoRow.archivedAt !== null) {
          throw new HttpError(409, 'This schedule belongs to an archived thread');
        }
        const projectRow = tx.select().from(project).where(eq(project.id, todoRow.projectId)).get();
        if (!projectRow || projectRow.teamId !== teamId) {
          throw new HttpError(404, `schedule ${id} not found`);
        }
        if (projectRow.archivedAt !== null) {
          throw new HttpError(409, 'This schedule belongs to an archived project');
        }
        activeTargetId = todoRow.latestBuildId;
      } else {
        throw new HttpError(404, `schedule ${id} not found`);
      }
      if (!row.enabled) throw new HttpError(409, 'This schedule is paused; resume it first');
      if (activeTargetId !== null && hasActiveStep(txDeps, activeTargetId)) {
        throw new HttpError(409, 'This thread is already running');
      }
      const now = nowMs();
      if (row.nextRunAt !== null && row.nextRunAt <= now && row.retryNotBefore === null) {
        throw new HttpError(409, 'This schedule is already queued to run');
      }
      tx.update(schedule)
        .set({ nextRunAt: now, retryNotBefore: null })
        .where(eq(schedule.id, id))
        .run();
      clearScheduleDueEvent(tx, id);
      const current = tx.select().from(schedule).where(eq(schedule.id, id)).get();
      const mapped = current ? toScheduleRecord(txDeps, current) : null;
      if (!mapped) throw new HttpError(404, `schedule ${id} not found`);
      return mapped;
    },
    { behavior: 'immediate' },
  );
  notifyScheduleClock(deps.db, deps);
  return record;
}
