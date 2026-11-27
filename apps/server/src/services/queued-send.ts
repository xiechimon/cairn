import { ACTIVE_STEP_STATUSES, type ThreadMessageDelivery } from '@cairn/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, clientMessage, queuedMessage, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
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

export function externalClientMessageId(explicit?: string, ledgerKey?: string): string | undefined {
  if (explicit !== undefined) return explicit;
  return ledgerKey !== undefined && !ledgerKey.startsWith('nested:') ? ledgerKey : undefined;
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
  todoId: string,
  clientMessageId: string,
  sendNow = false,
): QueuedSend | undefined {
  const task = db.select().from(todo).where(eq(todo.id, todoId)).get();
  const scopes = buildsOf(db, todoId);
  if (task === undefined || scopes.length === 0) return undefined;
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

export function forgetCancelledSend(db: Db, todoId: string, messageId: string): void {
  const receipts = db
    .select()
    .from(clientMessage)
    .where(inArray(clientMessage.scopeId, buildsOf(db, todoId)))
    .all()
    .filter((entry) => isQueuedReceipt(entry.response) && entry.response.message.id === messageId);
  for (const entry of receipts)
    db.update(clientMessage)
      .set({ response: { ...(entry.response as QueuedReceipt), cancelled: true } })
      .where(
        and(
          eq(clientMessage.scopeId, entry.scopeId),
          eq(clientMessage.clientMessageId, entry.clientMessageId),
        ),
      )
      .run();
}

export function refuseRemovedSend(db: Db, todoId: string, clientMessageId: string): void {
  const removed = db
    .select({ response: clientMessage.response })
    .from(clientMessage)
    .where(
      and(
        eq(clientMessage.clientMessageId, clientMessageId),
        inArray(clientMessage.scopeId, buildsOf(db, todoId)),
      ),
    )
    .all()
    .some((entry) => isQueuedReceipt(entry.response) && entry.response.cancelled === true);
  if (removed) throw removedFromQueue();
}

export interface Replacement {
  messageId: string;
  commit: () => void;
}

const replacedByResend = new WeakMap<Db, Set<string>>();

function noteReplaced(db: Db, messageId: string): void {
  const noted = replacedByResend.get(db) ?? new Set<string>();
  replacedByResend.set(db, noted.add(messageId));
}

export function sentByResend(db: Db, todoId: string, messageId: string): boolean {
  if (!replacedByResend.get(db)?.has(messageId)) return false;
  if (db.select().from(queuedMessage).where(eq(queuedMessage.id, messageId)).get()) return false;
  return !db
    .select({ response: clientMessage.response })
    .from(clientMessage)
    .where(inArray(clientMessage.scopeId, buildsOf(db, todoId)))
    .all()
    .some(
      (entry) =>
        isQueuedReceipt(entry.response) &&
        entry.response.message.id === messageId &&
        entry.response.cancelled === true,
    );
}

export async function replacingStrandedSend<T>(
  db: Db,
  todoId: string,
  resend: { clientMessageId?: string; content: string; sendNow?: boolean },
  send: (replacement?: Replacement) => Promise<T>,
): Promise<T> {
  const { clientMessageId, content, sendNow } = resend;
  if (clientMessageId === undefined) return send();
  const found = queuedSendUnderKey(db, todoId, clientMessageId, sendNow);
  if (found?.kind === 'cancelled') throw removedFromQueue();
  if (found?.kind !== 'stranded') return send();
  const queuedRow = eq(queuedMessage.id, found.messageId);
  const commit = () => {
    const receipt = findClientMessage<QueuedReceipt>(db, found.scopeId, clientMessageId);
    const row = db.select().from(queuedMessage).where(queuedRow).get();
    if (receipt?.message.id !== found.messageId || row === undefined)
      throw new HttpError(409, 'Queued message was already delivered');
    if (row.content.trim() === content.trim()) {
      db.delete(queuedMessage).where(queuedRow).run();
      noteReplaced(db, row.id);
    }
    db.delete(clientMessage)
      .where(
        and(
          eq(clientMessage.scopeId, found.scopeId),
          eq(clientMessage.clientMessageId, clientMessageId),
        ),
      )
      .run();
  };
  try {
    return await send({ messageId: found.messageId, commit });
  } catch (error) {
    const now = queuedSendUnderKey(db, todoId, clientMessageId, sendNow);
    if (now?.kind === 'received') return now.answer as T;
    throw error;
  }
}
