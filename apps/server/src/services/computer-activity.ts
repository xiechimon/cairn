import { type ComputerActivity, isBuildStepKind, isChiefConversationId } from '@cairn/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefThread, type computer, computerCall, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

const CALLS_SCANNED = 20;
const IN_FLIGHT_CALL_STATES: readonly string[] = ['dispatched', 'running'];

export function userOfStep(
  db: Db,
  userId: string,
  stepId: string,
  inUse: boolean,
  at: number,
): ComputerActivity | null {
  const owner = db.select().from(step).where(eq(step.id, stepId)).get();
  if (owner === undefined) return null;
  if (owner.kind === 'chief') {
    if (!isChiefConversationId(owner.buildId)) return null;
    const thread = db
      .select({ userId: chiefThread.userId })
      .from(chiefThread)
      .where(eq(chiefThread.id, owner.buildId))
      .get();
    return thread?.userId === userId
      ? { inUse, title: null, todoId: null, threadId: owner.buildId, at }
      : null;
  }
  if (!isBuildStepKind(owner.kind)) return null;
  const task = db
    .select({ id: todo.id, title: todo.title })
    .from(build)
    .innerJoin(todo, eq(todo.id, build.todoId))
    .where(eq(build.id, owner.buildId))
    .get();
  return task === undefined
    ? null
    : { inUse, title: task.title, todoId: task.id, threadId: null, at };
}

function newest(rows: ComputerActivity[]): ComputerActivity | null {
  return rows.reduce<ComputerActivity | null>(
    (best, row) => (best === null || row.at > best.at ? row : best),
    null,
  );
}

export function computerActivity(
  db: Db,
  userId: string,
  row: Pick<
    typeof computer.$inferSelect,
    'id' | 'teamId' | 'executionStepId' | 'executionLeaseExpiresAt' | 'runningSince' | 'updatedAt'
  >,
): ComputerActivity | null {
  const fromCalls = db
    .select()
    .from(computerCall)
    .where(and(eq(computerCall.teamId, row.teamId), eq(computerCall.computerId, row.id)))
    .orderBy(desc(computerCall.createdAt), desc(computerCall.id))
    .limit(CALLS_SCANNED)
    .all()
    .flatMap((call) => {
      const inUse = IN_FLIGHT_CALL_STATES.includes(call.state);
      const at = inUse ? (call.startedAt ?? call.createdAt) : (call.finishedAt ?? call.createdAt);
      const found = userOfStep(db, userId, call.stepId, inUse, at);
      return found === null ? [] : [found];
    });
  const leased =
    row.executionStepId !== null && (row.executionLeaseExpiresAt ?? 0) > nowMs()
      ? userOfStep(db, userId, row.executionStepId, true, row.runningSince ?? row.updatedAt)
      : null;
  const candidates = leased === null ? fromCalls : [...fromCalls, leased];
  return newest(candidates.filter((c) => c.inUse)) ?? newest(candidates.filter((c) => !c.inUse));
}
