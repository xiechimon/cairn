import { ACTIVE_STEP_STATUSES, type ThreadMessageDelivery } from '@cairn/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, clientMessage, queuedMessage, step, type todo } from '../db/schema.js';
import { completeClientMessage, findClientMessage, removedFromQueue } from './client-message.js';

type TodoRow = typeof todo.$inferSelect;

export interface QueuedReceipt {
  via: 'queue';
  conversationId: string;
  delivered?: ThreadMessageDelivery;
  message: { id: string };
  cancelled?: true;
}

export type QueuedSend =
  | {
      kind: 'received';
      conversationId: string;
      delivered: ThreadMessageDelivery;
      answer: object;
      waitingMessageId?: string;
    }
  | { kind: 'stranded'; scopeId: string; messageId: string }
  | { kind: 'cancelled' };

export function latestStepStatus(db: Db, conversationId: string) {
  return db
    .select({ status: step.status })
    .from(step)
    .where(eq(step.buildId, conversationId))
    .orderBy(desc(step.createdAt), sql`rowid DESC`)
    .get()?.status;
}

export function buildsOf(db: Db, todoId: string): string[] {
  return db
    .select({ id: build.id })
    .from(build)
    .where(eq(build.todoId, todoId))
    .all()
    .map((row) => row.id);
}

export function moveQueuedMessages(
  db: Db,
  fromConversationId: string,
  toConversationId: string,
): void {
  if (fromConversationId === toConversationId) return;
  db.update(queuedMessage)
    .set({ conversationId: toConversationId })
    .where(eq(queuedMessage.conversationId, fromConversationId))
    .run();
}

function isQueuedReceipt(response: unknown): response is QueuedReceipt {
  return (
    response !== null && typeof response === 'object' && (response as QueuedReceipt).via === 'queue'
  );
}

export function nestedLedgerId(todoId: string, clientMessageId: string): string {
  return `nested:${todoId}:${clientMessageId}`;
}

function anyReceipt(db: Db, todoId: string, clientMessageId: string): boolean {
  return (
    db
      .select({ scopeId: clientMessage.scopeId })
      .from(clientMessage)
      .where(
        and(
          inArray(clientMessage.scopeId, [todoId, ...buildsOf(db, todoId)]),
          inArray(clientMessage.clientMessageId, [
            clientMessageId,
            nestedLedgerId(todoId, clientMessageId),
          ]),
        ),
      )
      .get() !== undefined
  );
}

export function markAsQueuedSend(
  db: Db,
  scopeId: string,
  clientMessageId: string | undefined,
): void {
  const stored = findClientMessage<object>(db, scopeId, clientMessageId);
  if (stored === undefined) return;
  completeClientMessage(db, scopeId, clientMessageId, { ...stored, via: 'queue' });
}

type QueuedRow = typeof queuedMessage.$inferSelect;

function onTheOpenRun(task: TodoRow, row: QueuedRow): boolean {
  if (task.archivedAt !== null || task.phase === 'closed') return false;
  return task.latestBuildId === row.conversationId && row.error === null;
}

function hasActiveStep(db: Db, conversationId: string): boolean {
  return (
    db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, conversationId), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
      .get() !== undefined
  );
}

function staysQueued(db: Db, task: TodoRow, row: QueuedRow, sendNow: boolean): boolean {
  if (!onTheOpenRun(task, row)) return false;
  if (hasActiveStep(db, row.conversationId)) return true;
  return !sendNow && latestStepStatus(db, row.conversationId) === 'stopped';
}

export function queuedSendUnderKey(
  db: Db,
  task: TodoRow,
  clientMessageId: string,
  sendNow = false,
): QueuedSend | undefined {
  const scopes = buildsOf(db, task.id);
  if (scopes.length === 0) return undefined;
  const found = db
    .select({ scopeId: clientMessage.scopeId, response: clientMessage.response })
    .from(clientMessage)
    .where(
      and(
        eq(clientMessage.clientMessageId, clientMessageId),
        inArray(clientMessage.scopeId, scopes),
      ),
    )
    .all()
    .find((entry) => isQueuedReceipt(entry.response));
  if (found === undefined) return undefined;
  const { via: _via, cancelled, ...answer } = found.response as QueuedReceipt;
  if (cancelled) return { kind: 'cancelled' };
  if (answer.delivered !== undefined)
    return {
      kind: 'received',
      conversationId: answer.conversationId,
      delivered: answer.delivered,
      answer,
    };
  const messageId = answer.message.id;
  const row = db.select().from(queuedMessage).where(eq(queuedMessage.id, messageId)).get();
  if (row === undefined) {
    const conversationId = task.latestBuildId ?? answer.conversationId;
    return { kind: 'received', conversationId, delivered: 'steer', answer: { conversationId } };
  }
  if (!staysQueued(db, task, row, sendNow))
    return { kind: 'stranded', scopeId: found.scopeId, messageId };
  return {
    kind: 'received',
    conversationId: row.conversationId,
    delivered: 'steer',
    answer: {
      ...answer,
      conversationId: row.conversationId,
      message: { ...answer.message, conversationId: row.conversationId },
    },
    waitingMessageId: messageId,
  };
}

const takenForResend = new WeakMap<Db, Set<string>>();

function takenIn(db: Db): Set<string> {
  const existing = takenForResend.get(db);
  if (existing !== undefined) return existing;
  const created = new Set<string>();
  takenForResend.set(db, created);
  return created;
}

export function forgetCancelledSend(
  db: Db,
  todoId: string,
  messageId: string,
  removed: boolean,
): void {
  const heldByResend = takenIn(db).delete(messageId);
  if (!removed && !heldByResend) return;
  const scopes = buildsOf(db, todoId);
  const receipts = db
    .select()
    .from(clientMessage)
    .where(inArray(clientMessage.scopeId, scopes))
    .all()
    .filter((entry) => isQueuedReceipt(entry.response) && entry.response.message.id === messageId);
  for (const entry of receipts)
    db.update(clientMessage)
      .set({ response: asCancelled(entry.response) })
      .where(
        and(
          eq(clientMessage.scopeId, entry.scopeId),
          eq(clientMessage.clientMessageId, entry.clientMessageId),
        ),
      )
      .run();
}

function asCancelled(response: unknown): QueuedReceipt {
  return { ...(response as QueuedReceipt), cancelled: true };
}

export async function replacingStrandedSend<T>(
  db: Db,
  task: TodoRow,
  resend: { clientMessageId?: string; content: string; sendNow?: boolean },
  send: (refuseIfRemoved: () => void) => Promise<T>,
): Promise<T> {
  const { clientMessageId, content, sendNow } = resend;
  const nothingTaken = () => {};
  if (clientMessageId === undefined) return send(nothingTaken);
  const found = queuedSendUnderKey(db, task, clientMessageId, sendNow);
  if (found?.kind === 'cancelled') throw removedFromQueue();
  if (found?.kind !== 'stranded') return send(nothingTaken);
  const queuedRow = eq(queuedMessage.id, found.messageId);
  const ledger = and(
    eq(clientMessage.scopeId, found.scopeId),
    eq(clientMessage.clientMessageId, clientMessageId),
  );
  const taken = db.transaction(() => {
    const unedited = db.select().from(queuedMessage).where(queuedRow).get()?.content === content;
    return {
      row: unedited ? db.delete(queuedMessage).where(queuedRow).returning().get() : undefined,
      receipt: db.delete(clientMessage).where(ledger).returning().get(),
    };
  });
  takenIn(db).add(found.messageId);
  const removedMeanwhile = () => !takenIn(db).has(found.messageId);
  try {
    return await send(() => {
      if (removedMeanwhile()) throw removedFromQueue();
    });
  } catch (error) {
    const cancelledMeanwhile = removedMeanwhile();
    db.transaction(() => {
      if (anyReceipt(db, task.id, clientMessageId)) return;
      if (taken.row && !cancelledMeanwhile)
        db.insert(queuedMessage).values(taken.row).onConflictDoNothing().run();
      if (taken.receipt)
        db.insert(clientMessage)
          .values(
            cancelledMeanwhile
              ? { ...taken.receipt, response: asCancelled(taken.receipt.response) }
              : taken.receipt,
          )
          .onConflictDoNothing()
          .run();
    });
    throw error;
  } finally {
    takenIn(db).delete(found.messageId);
  }
}
