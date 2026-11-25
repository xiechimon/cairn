import { and, asc, eq, inArray } from 'drizzle-orm';
import { type build, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { BuildDeps } from './builds.js';
import { setTodoPhase } from './todos.js';

type BuildRow = typeof build.$inferSelect;

export function restoreFailedReview(deps: BuildDeps, row: BuildRow): void {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (todoRow?.phase !== 'failed') return;
  assertDeliveredBuild(deps, row);
  setTodoPhase(deps, todoRow.id, 'review');
}

export function buildRunsSession(deps: BuildDeps, buildId: string): boolean {
  return (
    deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, buildId), eq(step.kind, 'session')))
      .get() !== undefined
  );
}

export function assertDeliveredBuild(deps: BuildDeps, row: BuildRow): void {
  const { db } = deps;
  const buildStep = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, row.id), inArray(step.kind, ['build', 'session'])))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  const legDone = buildStep?.status === 'done';
  const artifactIn =
    (buildStep?.checkpointCommit ?? null) !== null || row.prUrl !== null || row.prNumber !== null;
  if (!legDone || !artifactIn) {
    const reason = !legDone ? 'build-not-delivered' : 'missing-delivery-artifact';
    const detail = !legDone ? 'build step did not finish' : 'missing delivery branch or PR';
    throw new HttpError(
      409,
      `merge is only available for a delivered build (${detail}); rerun the task`,
      reason,
    );
  }
}
