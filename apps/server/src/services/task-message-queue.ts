import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, queuedMessage, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { addUserMessageAttachmentGrants } from './attachment-authorization.js';
import { type BuildDeps, sendBuildSteer } from './builds.js';

const delivering = new WeakMap<Db, Map<string, Promise<unknown>>>();

export function readQueuedMessages(db: Db, conversationId: string) {
  return db
    .select()
    .from(queuedMessage)
    .where(eq(queuedMessage.conversationId, conversationId))
    .orderBy(asc(queuedMessage.createdAt), sql`rowid`)
    .all();
}

function activeStep(db: Db, conversationId: string) {
  return db
    .select()
    .from(step)
    .where(
      and(
        eq(step.buildId, conversationId),
        inArray(step.status, ['pending', 'claimed', 'waiting_quota']),
      ),
    )
    .get();
}

export async function queueTaskMessage(
  deps: BuildDeps,
  conversationId: string,
  content: string,
  deliverAfterStop = false,
) {
  const row = deps.db.select().from(build).where(eq(build.id, conversationId)).get();
  if (!row) throw new HttpError(404, `conversation ${conversationId}`);
  const task = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (
    !task ||
    task.archivedAt !== null ||
    task.latestBuildId !== conversationId ||
    task.phase === 'closed'
  )
    throw new HttpError(409, 'Task cannot accept a queued message');
  if (!activeStep(deps.db, conversationId))
    return sendBuildSteer(deps, conversationId, { content }, true);
  const message = {
    id: newRecordId(),
    conversationId,
    content,
    deliverAfterStop,
    createdAt: nowMs(),
  };
  deps.db.insert(queuedMessage).values(message).run();
  addUserMessageAttachmentGrants(deps.db, task.id, task.teamId, content);
  deps.convHub?.publishMessage(conversationId, { ...message, role: 'user' });
  return { conversationId, message };
}

export async function deliverQueuedMessage(
  deps: BuildDeps,
  conversationId: string,
  messageId: string,
  steer: boolean,
) {
  let locks = delivering.get(deps.db);
  if (!locks) {
    locks = new Map();
    delivering.set(deps.db, locks);
  }
  const pending = locks.get(messageId);
  if (pending) return pending;
  const delivery = (async () => {
    const row = deps.db
      .select()
      .from(queuedMessage)
      .where(and(eq(queuedMessage.id, messageId), eq(queuedMessage.conversationId, conversationId)))
      .get();
    if (!row) throw new HttpError(409, 'Queued message was already delivered');
    if (!steer && activeStep(deps.db, conversationId)) return;
    try {
      return await sendBuildSteer(
        deps,
        conversationId,
        { content: row.content, queuedMessageId: row.id },
        true,
      );
    } catch (error) {
      if (error instanceof HttpError)
        deps.db
          .update(queuedMessage)
          .set({ error: error.message })
          .where(eq(queuedMessage.id, row.id))
          .run();
      throw error;
    }
  })();
  locks.set(messageId, delivery);
  try {
    return await delivery;
  } finally {
    locks.delete(messageId);
  }
}

export function cancelQueuedMessage(deps: BuildDeps, conversationId: string, messageId: string) {
  deps.db
    .delete(queuedMessage)
    .where(and(eq(queuedMessage.id, messageId), eq(queuedMessage.conversationId, conversationId)))
    .run();
  return { conversationId };
}

export async function drainTaskMessageQueue(
  deps: BuildDeps,
  conversationId: string,
): Promise<void> {
  if (activeStep(deps.db, conversationId)) return;
  const latest = deps.db
    .select()
    .from(step)
    .where(eq(step.buildId, conversationId))
    .orderBy(desc(step.createdAt), sql`rowid DESC`)
    .get();
  if (latest?.status === 'failed') return;
  const next = readQueuedMessages(deps.db, conversationId).find(
    (row) => row.error === null && (latest?.status !== 'stopped' || row.deliverAfterStop),
  );
  if (!next) return;
  try {
    await deliverQueuedMessage(deps, conversationId, next.id, false);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
  }
}
