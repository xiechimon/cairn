import { BUILD_FAILURE_ROW_KIND, systemRowOf } from '@cairn/shared';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { message, step, todo } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { emitRuntimeBuildSpan } from '../runtime-otel.js';
import { stopUnclaimedGateSteps } from './build-stop.js';
import type { BuildDeps } from './builds.js';
import { DONE_ROW } from './delivery-rows.js';
import { markFirstPrPromptDue } from './first-pr-report.js';
import { assertPhaseTransition } from './phase.js';
import { setTodoPhase } from './todos.js';
import { insertMessageRow } from './transcript.js';

export function hasFailureRow(deps: BuildDeps, buildId: string, reason: string): boolean {
  return deps.db
    .select({ content: message.content })
    .from(message)
    .where(and(eq(message.conversationId, buildId), eq(message.role, 'system')))
    .all()
    .some((row) => {
      const parsed = systemRowOf(row.content);
      return parsed?.kind === BUILD_FAILURE_ROW_KIND && parsed.reason === reason;
    });
}

export function roundStart(deps: BuildDeps, buildId: string): number {
  return (
    deps.db
      .select({ at: step.createdAt })
      .from(step)
      .where(and(eq(step.buildId, buildId), inArray(step.kind, ['build', 'session', 'plan'])))
      .orderBy(desc(step.createdAt))
      .get()?.at ?? 0
  );
}

export function hasMessageRow(
  deps: BuildDeps,
  buildId: string,
  role: 'system' | 'user',
  content: string,
  since = 0,
): boolean {
  return (
    deps.db
      .select({ id: message.id })
      .from(message)
      .where(
        and(
          eq(message.conversationId, buildId),
          eq(message.role, role),
          eq(message.content, content),
          gte(message.createdAt, since),
        ),
      )
      .get() !== undefined
  );
}

export function finishTodoDone(deps: BuildDeps, todoId: string, buildId: string): void {
  const current = deps.db
    .select({ phase: todo.phase })
    .from(todo)
    .where(eq(todo.id, todoId))
    .get()?.phase;
  if (current !== undefined) assertPhaseTransition(current, 'done');
  stopUnclaimedGateSteps(deps, buildId);
  setTodoPhase(deps, todoId, 'done', {}, { landedMerge: true });
  insertMessageRow(deps, buildId, {
    id: newRecordId(),
    role: 'system',
    content: DONE_ROW,
    createdAt: nowMs(),
  });
  emitRuntimeBuildSpan(deps.db, buildId, 'done');
  markFirstPrPromptDue(deps.db, buildId);
}
