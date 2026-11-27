import { ACTIVE_STEP_STATUSES, type Phase } from '@cairn/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { build, queuedMessage, steerPending, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { BUILD_ABANDONED_STEP_MS } from './build-abandoned-sweep.js';
import { type BuildDeps, publishBuild } from './builds.js';
import { scheduleOrParkFailedBuild } from './retry-parking.js';
import { setTodoPhase } from './todos.js';
import { pendingWorkerQuestions } from './worker-question-store.js';

export const STALLED_RUN_MESSAGE = '这一轮已经结束，但任务没有收到结果，系统把它标为失败。';

const RUNNING_PHASES: readonly Phase[] = ['planning', 'building', 'needs_input'];

export function sweepStalledRunningTodos(deps: BuildDeps, now: number = nowMs()): number {
  const { db } = deps;
  const rows = db
    .select()
    .from(todo)
    .where(and(inArray(todo.phase, [...RUNNING_PHASES]), isNull(todo.archivedAt)))
    .all();
  let settled = 0;
  for (const row of rows) {
    if (row.latestBuildId === null || now - row.phaseAt <= BUILD_ABANDONED_STEP_MS) continue;
    const buildId = row.latestBuildId;
    const steps = db
      .select({ status: step.status, finishedAt: step.finishedAt })
      .from(step)
      .where(eq(step.buildId, buildId))
      .orderBy(desc(step.createdAt))
      .all();
    if (steps.some((s) => (ACTIVE_STEP_STATUSES as readonly string[]).includes(s.status))) continue;
    const lastFinished = steps[0]?.finishedAt ?? null;
    if (lastFinished !== null && now - lastFinished <= BUILD_ABANDONED_STEP_MS) continue;
    if (pendingWorkerQuestions(db, buildId).length > 0) continue;
    const queued = db
      .select({ id: queuedMessage.id })
      .from(queuedMessage)
      .where(and(eq(queuedMessage.conversationId, buildId), isNull(queuedMessage.error)))
      .get();
    if (queued !== undefined) continue;
    const steer = db
      .select({ id: steerPending.conversationId })
      .from(steerPending)
      .where(eq(steerPending.conversationId, buildId))
      .get();
    if (steer !== undefined) continue;
    db.update(build)
      .set({
        errorMessage: STALLED_RUN_MESSAGE,
        failureCode: 'runner_disconnect',
        failureDetail: null,
      })
      .where(and(eq(build.id, buildId), isNull(build.errorMessage)))
      .run();
    scheduleOrParkFailedBuild(deps, buildId, now);
    const buildRow = db.select().from(build).where(eq(build.id, buildId)).get();
    if (buildRow) publishBuild(deps, buildRow);
    setTodoPhase(deps, row.id, 'failed');
    settled += 1;
  }
  return settled;
}
