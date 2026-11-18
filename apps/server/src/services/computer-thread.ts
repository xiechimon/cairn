import { chiefIdFormat, isBuildStepKind, isInfoOutput } from '@cairn/shared';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefThread, type step, todo } from '../db/schema.js';
import { isChiefConversation } from './machine-deps.js';

export type ComputerThread = Pick<
  typeof chiefThread.$inferSelect,
  'id' | 'chiefId' | 'userId' | 'teamId'
>;

export const NO_CARD_THREAD = '';

export function browserScopeFor(thread: Pick<ComputerThread, 'id' | 'chiefId'>): string {
  return thread.id === NO_CARD_THREAD ? `chief-fallback:${thread.chiefId}` : thread.id;
}

export function infoCardTodoOf(
  db: Pick<Db, 'select'>,
  stepRow: Pick<typeof step.$inferSelect, 'kind' | 'buildId'>,
): typeof todo.$inferSelect | null {
  if (!isBuildStepKind(stepRow.kind)) return null;
  const row = db
    .select({ todoRow: todo })
    .from(build)
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(eq(build.id, stepRow.buildId))
    .get();
  return row !== undefined && isInfoOutput(row.todoRow.output) ? row.todoRow : null;
}

export function computerThreadOf(
  db: Pick<Db, 'select'>,
  stepRow: Pick<typeof step.$inferSelect, 'kind' | 'buildId'>,
): ComputerThread | null {
  if (stepRow.kind === 'chief' && isChiefConversation(stepRow.buildId)) {
    return db.select().from(chiefThread).where(eq(chiefThread.id, stepRow.buildId)).get() ?? null;
  }
  const todoRow = infoCardTodoOf(db, stepRow);
  if (todoRow === null) return null;
  const userId = todoRow.ownerId ?? todoRow.createdBy;
  if (userId === null) return null;
  const chiefId = chiefIdFormat(userId, todoRow.teamId);
  const latest = db
    .select({ id: chiefThread.id })
    .from(chiefThread)
    .where(eq(chiefThread.chiefId, chiefId))
    .orderBy(desc(chiefThread.updatedAt))
    .get();
  return { id: latest?.id ?? NO_CARD_THREAD, chiefId, userId, teamId: todoRow.teamId };
}
