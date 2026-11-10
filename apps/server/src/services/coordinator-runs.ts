import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { coordinatorInput, coordinatorRun } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

export function coordinatorRuns(db: Db, threadId: string) {
  return db.select().from(coordinatorRun).where(eq(coordinatorRun.threadId, threadId)).all();
}

export function bindCoordinatorRun(
  db: Db,
  threadId: string,
  conversationId: string,
  taskId: string,
  requestIds: readonly string[],
): void {
  if (requestIds.length === 0) throw new HttpError(409, 'Coordinator run has no input authority');
  const producers = new Set<string>();
  for (const id of requestIds) {
    const input = db.select().from(coordinatorInput).where(eq(coordinatorInput.id, id)).get();
    if (
      input?.threadId !== threadId ||
      input.conversationId !== conversationId ||
      input.state !== 'consumed'
    )
      throw new HttpError(409, 'Coordinator run input authority is incomplete');
    producers.add(input.stepId);
  }
  const stepId = [...producers][0];
  if (producers.size !== 1 || stepId === undefined)
    throw new HttpError(409, 'Coordinator run crosses producer boundaries');
  const existing = db
    .select()
    .from(coordinatorRun)
    .where(
      and(
        eq(coordinatorRun.threadId, threadId),
        eq(coordinatorRun.conversationId, conversationId),
        eq(coordinatorRun.taskId, taskId),
      ),
    )
    .get();
  if (existing !== undefined) {
    if (existing.stepId !== stepId)
      throw new HttpError(409, 'Coordinator run already has another producer');
    return;
  }
  db.insert(coordinatorRun).values({ threadId, conversationId, taskId, stepId }).run();
}
