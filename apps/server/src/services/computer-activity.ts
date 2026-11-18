import { type ComputerActivity, isBuildStepKind, isChiefConversationId } from '@cairn/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, computerCall, step, todo } from '../db/schema.js';
import { computerCallOwnerUserId } from './computer-access.js';

const ROWS_SCANNED = 20;
const IN_FLIGHT_CALL_STATES: readonly string[] = ['dispatched', 'running'];

function taskActivity(
  db: Db,
  stepRow: typeof step.$inferSelect,
  inUse: boolean,
  at: number,
): ComputerActivity | null {
  if (!isBuildStepKind(stepRow.kind)) return null;
  const task = db
    .select({ id: todo.id, title: todo.title })
    .from(build)
    .innerJoin(todo, eq(todo.id, build.todoId))
    .where(eq(build.id, stepRow.buildId))
    .get();
  return task === undefined
    ? null
    : { inUse, title: task.title, todoId: task.id, threadId: null, at };
}

function taskActivities(db: Db, machineId: string): ComputerActivity[] {
  const claimed = db
    .select()
    .from(step)
    .where(and(eq(step.machineId, machineId), eq(step.status, 'claimed')))
    .orderBy(desc(step.claimedAt))
    .limit(ROWS_SCANNED)
    .all()
    .map((row) => taskActivity(db, row, true, row.claimedAt ?? row.createdAt));
  const finished = db
    .select()
    .from(step)
    .where(and(eq(step.machineId, machineId), inArray(step.status, ['done', 'failed', 'stopped'])))
    .orderBy(desc(step.finishedAt))
    .limit(ROWS_SCANNED)
    .all()
    .map((row) => taskActivity(db, row, false, row.finishedAt ?? row.createdAt));
  return [...claimed, ...finished].filter((row): row is ComputerActivity => row !== null);
}

function coordinatorActivities(
  db: Db,
  teamId: string,
  userId: string,
  computerId: string,
): ComputerActivity[] {
  return db
    .select()
    .from(computerCall)
    .where(and(eq(computerCall.teamId, teamId), eq(computerCall.computerId, computerId)))
    .orderBy(desc(computerCall.createdAt), desc(computerCall.id))
    .limit(ROWS_SCANNED)
    .all()
    .filter((call) => computerCallOwnerUserId(db, call) === userId)
    .flatMap((call) => {
      const owner = db.select().from(step).where(eq(step.id, call.stepId)).get();
      if (owner === undefined || !isChiefConversationId(owner.buildId)) return [];
      const inUse = IN_FLIGHT_CALL_STATES.includes(call.state);
      const at = inUse ? (call.startedAt ?? call.createdAt) : (call.finishedAt ?? call.createdAt);
      return [{ inUse, title: null, todoId: null, threadId: owner.buildId, at }];
    });
}

function newest(rows: ComputerActivity[]): ComputerActivity | null {
  return rows.reduce<ComputerActivity | null>(
    (best, row) => (best === null || row.at > best.at ? row : best),
    null,
  );
}

export function computerActivity(
  db: Db,
  teamId: string,
  userId: string,
  computerId: string,
  machineId: string,
): ComputerActivity | null {
  const candidates = [
    ...taskActivities(db, machineId),
    ...coordinatorActivities(db, teamId, userId, computerId),
  ];
  return (
    newest(candidates.filter((row) => row.inUse)) ?? newest(candidates.filter((row) => !row.inUse))
  );
}
