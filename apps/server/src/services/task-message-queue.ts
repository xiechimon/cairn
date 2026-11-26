import { ACTIVE_STEP_STATUSES, TASK_CLOSED } from '@cairn/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, queuedMessage, step, todo } from '../db/schema.js';
import { HttpError, taskArchived } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { addUserMessageAttachmentGrants } from './attachment-authorization.js';
import { type BuildDeps, type BuildSteerResult, sendBuildSteer } from './builds.js';
import {
  claimClientMessage,
  coalesceClientMessage,
  completeClientMessage,
  findClientMessage,
  removedFromQueue,
  replayAfterConflict,
} from './client-message.js';
import {
  buildsOf,
  forgetCancelledSend,
  latestStepStatus,
  markAsQueuedSend,
  queuedSendUnderKey,
  type Replacement,
  replacingStrandedSend,
  sentByResend,
} from './queued-send.js';
import { threadSendUnderKey } from './thread-message.js';

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
    .where(and(eq(step.buildId, conversationId), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
    .get();
}

export interface QueuedTaskMessageResult {
  conversationId: string;
  message: {
    id: string;
    conversationId: string;
    content: string;
    deliverAfterStop: boolean;
    createdAt: number;
  };
}

export async function queueTaskMessage(
  deps: BuildDeps,
  conversationId: string,
  content: string,
  deliverAfterStop = false,
  clientMessageId?: string,
): Promise<BuildSteerResult | QueuedTaskMessageResult | { conversationId: string }> {
  const row = deps.db.select().from(build).where(eq(build.id, conversationId)).get();
  const task = row && deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  const replied =
    task && clientMessageId !== undefined
      ? threadSendUnderKey(deps, task, clientMessageId)
      : undefined;
  if (replied !== undefined) return { conversationId: replied.conversationId };
  const earlier =
    task && clientMessageId !== undefined
      ? queuedSendUnderKey(deps.db, task, clientMessageId, deliverAfterStop)
      : undefined;
  if (earlier?.kind === 'cancelled') throw removedFromQueue();
  if (earlier?.kind === 'received') {
    if (deliverAfterStop && earlier.waitingMessageId !== undefined)
      deps.db
        .update(queuedMessage)
        .set({ deliverAfterStop: true })
        .where(eq(queuedMessage.id, earlier.waitingMessageId))
        .run();
    return earlier.answer as BuildSteerResult | QueuedTaskMessageResult;
  }
  if (earlier === undefined) {
    const replay = findClientMessage<BuildSteerResult | QueuedTaskMessageResult>(
      deps.db,
      conversationId,
      clientMessageId,
    );
    if (replay !== undefined) return replay;
  }
  if (!row) throw new HttpError(404, `conversation ${conversationId}`);
  if (task?.archivedAt != null) throw taskArchived();
  if (task?.phase === 'closed')
    throw new HttpError(409, 'Task cannot accept a queued message', TASK_CLOSED);
  const latestRun =
    task?.latestBuildId == null
      ? undefined
      : deps.db.select().from(build).where(eq(build.id, task.latestBuildId)).get();
  if (!task || latestRun === undefined)
    throw new HttpError(409, 'Task cannot accept a queued message');
  const runId = latestRun.id;
  const send = async (replacing?: Replacement) => {
    if (!activeStep(deps.db, runId))
      return sendBuildSteer(
        deps,
        runId,
        { content, clientMessageId },
        {
          afterTurn: true,
          origin: 'user',
          replacing,
          beforeCommit: () => markAsQueuedSend(deps.db, runId, clientMessageId),
        },
      );
    const message = {
      id: newRecordId(),
      conversationId: runId,
      content,
      deliverAfterStop,
      createdAt: nowMs(),
    };
    const queued = { conversationId: runId, message };
    try {
      deps.db.transaction(() => {
        replacing?.commit();
        claimClientMessage(deps.db, runId, clientMessageId);
        deps.db.insert(queuedMessage).values(message).run();
        addUserMessageAttachmentGrants(deps.db, task.id, task.teamId, content);
        completeClientMessage(deps.db, runId, clientMessageId, queued);
        markAsQueuedSend(deps.db, runId, clientMessageId);
      });
    } catch (error) {
      return replayAfterConflict<QueuedTaskMessageResult>(deps.db, runId, clientMessageId, error);
    }
    deps.convHub?.publishMessage(runId, { ...message, role: 'user' }, undefined, clientMessageId);
    return queued;
  };
  return coalesceClientMessage(deps.db, task.id, clientMessageId, () =>
    replacingStrandedSend<BuildSteerResult | QueuedTaskMessageResult>(
      deps.db,
      task,
      { clientMessageId, content, sendNow: deliverAfterStop },
      send,
    ),
  );
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
      const todoId = deps.db.select().from(build).where(eq(build.id, conversationId)).get()?.todoId;
      if (todoId !== undefined && sentByResend(deps.db, todoId, row.id)) return { conversationId };
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
  deps.db.transaction(() => {
    const row = deps.db.select().from(build).where(eq(build.id, conversationId)).get();
    if (!row) return;
    const cancelled = deps.db
      .delete(queuedMessage)
      .where(
        and(
          eq(queuedMessage.id, messageId),
          inArray(queuedMessage.conversationId, buildsOf(deps.db, row.todoId)),
        ),
      )
      .run().changes;
    if (cancelled > 0) forgetCancelledSend(deps.db, row.todoId, messageId);
  });
  return { conversationId };
}

export function editQueuedMessage(
  deps: BuildDeps,
  conversationId: string,
  messageId: string,
  content: string,
) {
  const updated = deps.db
    .update(queuedMessage)
    .set({ content })
    .where(
      and(
        eq(queuedMessage.id, messageId),
        eq(queuedMessage.conversationId, conversationId),
        isNull(queuedMessage.error),
      ),
    )
    .returning({ id: queuedMessage.id })
    .all();
  if (updated.length === 0) throw new HttpError(409, 'Queued message was already delivered');
  const row = deps.db.select().from(build).where(eq(build.id, conversationId)).get();
  const task = row && deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (task) addUserMessageAttachmentGrants(deps.db, task.id, task.teamId, content);
  return { conversationId, message: { id: messageId, content } };
}

export async function drainTaskMessageQueue(
  deps: BuildDeps,
  conversationId: string,
): Promise<void> {
  if (activeStep(deps.db, conversationId)) return;
  const latest = latestStepStatus(deps.db, conversationId);
  if (latest === 'failed') return;
  const next = readQueuedMessages(deps.db, conversationId).find(
    (row) => row.error === null && (latest !== 'stopped' || row.deliverAfterStop),
  );
  if (!next) return;
  try {
    await deliverQueuedMessage(deps, conversationId, next.id, false);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
  }
}
