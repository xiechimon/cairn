import {
  THREAD_MESSAGE_EXCERPT_MAX,
  type ThreadMessageBody,
  type ThreadMessageContent,
  type ThreadMessageDelivery,
  type ThreadMessageResult,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { chiefMessage, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { applyBuildStepAction, type BuildDeps, sendBuildSteer } from './builds.js';
import { coordinatorThreadRow, ensureChief } from './chief.js';
import {
  claimClientMessage,
  coalesceClientMessage,
  findClientMessage,
  replayAfterConflict,
} from './client-message.js';
import { answerWorkerQuestionsById, pendingWorkerQuestionIds } from './worker-question-store.js';

type TodoRow = typeof todo.$inferSelect;

function excerptOf(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length <= THREAD_MESSAGE_EXCERPT_MAX
    ? flat
    : `${flat.slice(0, THREAD_MESSAGE_EXCERPT_MAX - 1)}…`;
}

function hasClaimedStep(deps: BuildDeps, buildId: string): boolean {
  return (
    deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, buildId), eq(step.status, 'claimed')))
      .get() !== undefined
  );
}

function latestBuildOf(deps: BuildDeps, todoId: string): string | null {
  return (
    deps.db.select({ id: todo.latestBuildId }).from(todo).where(eq(todo.id, todoId)).get()?.id ??
    null
  );
}

async function deliver(
  deps: BuildDeps,
  row: TodoRow,
  buildId: string,
  body: ThreadMessageBody,
): Promise<{ conversationId: string; delivered: ThreadMessageDelivery }> {
  const running = hasClaimedStep(deps, buildId);
  if (running || row.phase === 'building' || row.phase === 'done') {
    const sent = await sendBuildSteer(
      deps,
      buildId,
      { content: body.content, clientMessageId: body.clientMessageId },
      { human: true },
    );
    return { conversationId: sent.conversationId, delivered: sent.delivered };
  }
  if (row.phase === 'confirm' || row.phase === 'review') {
    await applyBuildStepAction(deps, buildId, {
      action: 'revision',
      side: 'plan',
      feedback: body.content,
      clientMessageId: body.clientMessageId,
    });
    return { conversationId: latestBuildOf(deps, row.id) ?? buildId, delivered: 'revision' };
  }
  if (row.phase === 'failed') {
    await applyBuildStepAction(deps, buildId, {
      action: 'restart',
      feedback: body.content,
      clientMessageId: body.clientMessageId,
    });
    return { conversationId: latestBuildOf(deps, row.id) ?? buildId, delivered: 'restart' };
  }
  throw new HttpError(409, `thread #${row.seqNum} cannot take a message while ${row.phase}`);
}

function recordInCoordinator(
  deps: BuildDeps,
  row: TodoRow,
  body: ThreadMessageBody,
  sent: { conversationId: string; delivered: ThreadMessageDelivery },
): void {
  const thread = coordinatorThreadRow(deps, ensureChief(deps, row.teamId));
  const marker: ThreadMessageContent = {
    kind: 'thread-message',
    todoId: row.id,
    seqNum: row.seqNum,
    title: row.title,
    excerpt: excerptOf(body.content),
    delivered: sent.delivered,
    conversationId: sent.conversationId,
  };
  const message = {
    id: newRecordId(),
    role: 'system' as const,
    content: JSON.stringify(marker),
    createdAt: nowMs(),
  };
  deps.db.transaction(() => {
    claimClientMessage(deps.db, row.id, body.clientMessageId, { todoId: row.id, ...sent });
    deps.db
      .insert(chiefMessage)
      .values({ ...message, threadId: thread.id, projectId: row.projectId })
      .run();
  });
  deps.convHub?.publishMessage(thread.id, message);
}

export async function messageThreadAsUser(
  deps: BuildDeps,
  teamId: string,
  todoId: string,
  body: ThreadMessageBody,
): Promise<ThreadMessageResult> {
  const row = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), eq(todo.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `todo ${todoId}`);
  const replay = findClientMessage<ThreadMessageResult>(deps.db, row.id, body.clientMessageId);
  if (replay !== undefined) return replay;
  if (row.archivedAt !== null) throw new HttpError(409, 'Unarchive to continue');
  if (row.latestBuildId === null) {
    throw new HttpError(409, `thread #${row.seqNum} has not started yet`);
  }
  const buildId = row.latestBuildId;
  return coalesceClientMessage(deps.db, row.id, body.clientMessageId, async () => {
    const parked = pendingWorkerQuestionIds(deps.db, buildId);
    const sent = await deliver(deps, row, buildId, body);
    answerWorkerQuestionsById(deps, buildId, parked, body.content);
    try {
      recordInCoordinator(deps, row, body, sent);
    } catch (error) {
      return replayAfterConflict<ThreadMessageResult>(deps.db, row.id, body.clientMessageId, error);
    }
    return { todoId: row.id, ...sent };
  });
}
