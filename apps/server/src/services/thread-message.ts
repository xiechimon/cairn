import {
  redactSecrets,
  THREAD_MESSAGE_EXCERPT_MAX,
  type ThreadMessageBody,
  type ThreadMessageContent,
  type ThreadMessageDelivery,
  type ThreadMessageResult,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { build, chiefMessage, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { tidyText } from '../lib/tidy-text.js';
import {
  applyBuildStepAction,
  type BuildDeps,
  sendBuildSteer,
  startBuilds,
  stoppedBeforeFirstRun,
} from './builds.js';
import { coordinatorThreadRow, ensureChief } from './chief.js';
import {
  claimClientMessage,
  coalesceClientMessage,
  completeClientMessage,
  findClientMessage,
  replayAfterConflict,
} from './client-message.js';
import { assertProjectWritable } from './project-writable.js';
import { holdCodeThreadForPriorResearch } from './research-before-plan.js';
import { pendingWorkerQuestionIds, pendingWorkerQuestions } from './worker-question-store.js';
import { settleQuestionAnswers } from './worker-questions.js';

type TodoRow = typeof todo.$inferSelect;

export type ThreadMessageOrigin = { origin: 'user' } | { origin: 'coordinator'; actor: string };

const USER_ORIGIN: ThreadMessageOrigin = { origin: 'user' };

function nestedLedgerId(todoId: string, clientMessageId: string): string {
  return `nested:${todoId}:${clientMessageId}`;
}

function excerptOf(content: string): string {
  const flat = tidyText(redactSecrets(content).value as string);
  return flat.length <= THREAD_MESSAGE_EXCERPT_MAX
    ? flat
    : `${flat.slice(0, THREAD_MESSAGE_EXCERPT_MAX - 1)}…`;
}

function stepActionAttribution(
  origin: ThreadMessageOrigin,
): [actor: string | undefined, origin: 'person' | 'automatic'] {
  return origin.origin === 'user' ? [undefined, 'person'] : [origin.actor, 'automatic'];
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

function storedDelivery(
  receipt: unknown,
): { conversationId: string; delivered: ThreadMessageDelivery } | undefined {
  if (receipt === null || typeof receipt !== 'object') return undefined;
  const delivered = (receipt as { delivered?: unknown }).delivered;
  const conversationId = (receipt as { conversationId?: unknown }).conversationId;
  if (
    (delivered === 'steer' ||
      delivered === 'new-turn' ||
      delivered === 'revision' ||
      delivered === 'restart') &&
    typeof conversationId === 'string'
  ) {
    return { conversationId, delivered };
  }
  return undefined;
}

export function startThreadBuild(
  deps: BuildDeps,
  row: TodoRow,
  origin: ThreadMessageOrigin,
  prompt?: string,
): string {
  const [started] = startBuilds(deps, {
    projectId: row.projectId,
    todoIds: [row.id],
    triggerSource: origin.origin === 'user' ? 'user' : 'chief',
    prompt,
  });
  if (!started) throw new Error('build missing after start');
  holdCodeThreadForPriorResearch(deps, row.id);
  return started.id;
}

async function deliver(
  deps: BuildDeps,
  row: TodoRow,
  buildId: string,
  body: ThreadMessageBody,
  origin: ThreadMessageOrigin,
  beforeCommit?: () => void,
): Promise<{ conversationId: string; delivered: ThreadMessageDelivery }> {
  const nestedId = nestedLedgerId(row.id, body.clientMessageId);
  const pending = pendingWorkerQuestionIds(deps.db, buildId);
  if (origin.origin === 'coordinator' && pending.length > 0) {
    throw new HttpError(
      409,
      `thread #${row.seqNum} has a pending question (requestId ${pending.join(', ')}); answer it with answer_question`,
    );
  }
  const running = hasClaimedStep(deps, buildId);
  if (!running && (pending.length > 0 || row.phase === 'needs_input')) {
    const sent = await sendBuildSteer(
      deps,
      buildId,
      { content: body.content, clientMessageId: nestedId },
      { human: true, afterTurn: true, beforeCommit },
    );
    return { conversationId: sent.conversationId, delivered: sent.delivered };
  }
  if (running || row.phase === 'building' || row.phase === 'done') {
    const sent = await sendBuildSteer(
      deps,
      buildId,
      { content: body.content, clientMessageId: nestedId },
      {
        ...(origin.origin === 'user' ? { human: true } : { human: false, actor: origin.actor }),
        beforeCommit,
      },
    );
    return { conversationId: sent.conversationId, delivered: sent.delivered };
  }
  if (row.phase === 'confirm' || row.phase === 'review') {
    await applyBuildStepAction(
      deps,
      buildId,
      {
        action: 'revision',
        side: 'plan',
        feedback: body.content,
        clientMessageId: nestedId,
      },
      ...stepActionAttribution(origin),
      beforeCommit,
    );
    const revised = storedDelivery(findClientMessage(deps.db, buildId, nestedId));
    if (revised === undefined) throw new Error('revision receipt missing');
    return revised;
  }
  if (row.phase === 'failed') {
    await applyBuildStepAction(
      deps,
      buildId,
      { action: 'restart', feedback: body.content, clientMessageId: nestedId },
      ...stepActionAttribution(origin),
      beforeCommit,
    );
    const restarted = storedDelivery(findClientMessage(deps.db, buildId, nestedId));
    if (restarted === undefined) throw new Error('restart receipt missing');
    return restarted;
  }
  throw new HttpError(409, `thread #${row.seqNum} cannot take a message while ${row.phase}`);
}

function insertCoordinatorMarker(
  deps: BuildDeps,
  row: TodoRow,
  body: ThreadMessageBody,
  sent: { conversationId: string; delivered: ThreadMessageDelivery },
  origin: ThreadMessageOrigin,
): {
  threadId: string;
  message: { id: string; role: 'system'; content: string; createdAt: number };
} {
  const thread = coordinatorThreadRow(deps, ensureChief(deps, row.teamId));
  const marker: ThreadMessageContent = {
    kind: 'thread-message',
    todoId: row.id,
    seqNum: row.seqNum,
    title: row.title,
    excerpt: excerptOf(body.content),
    delivered: sent.delivered,
    conversationId: sent.conversationId,
    by: origin.origin,
  };
  const message = {
    id: newRecordId(),
    role: 'system' as const,
    content: JSON.stringify(marker),
    projectId: row.projectId,
    createdAt: nowMs(),
  };
  deps.db
    .insert(chiefMessage)
    .values({ ...message, threadId: thread.id })
    .run();
  return { threadId: thread.id, message };
}

function recordInCoordinator(
  deps: BuildDeps,
  row: TodoRow,
  body: ThreadMessageBody,
  sent: { conversationId: string; delivered: ThreadMessageDelivery },
  origin: ThreadMessageOrigin,
): void {
  const published = deps.db.transaction(() => {
    claimClientMessage(deps.db, row.id, body.clientMessageId, { todoId: row.id, ...sent });
    return insertCoordinatorMarker(deps, row, body, sent, origin);
  });
  deps.convHub?.publishMessage(published.threadId, published.message);
}

function commitStoppedRestart(
  deps: BuildDeps,
  row: TodoRow,
  body: ThreadMessageBody,
  origin: ThreadMessageOrigin,
): ThreadMessageResult {
  let result: ThreadMessageResult = {
    todoId: row.id,
    conversationId: row.latestBuildId ?? row.id,
    delivered: 'restart',
  };
  const published = deps.db.transaction(() => {
    claimClientMessage(deps.db, row.id, body.clientMessageId);
    const conversationId = startThreadBuild(deps, row, origin, body.content);
    result = { todoId: row.id, conversationId, delivered: 'restart' };
    completeClientMessage(deps.db, row.id, body.clientMessageId, result);
    return insertCoordinatorMarker(deps, row, body, result, origin);
  });
  deps.convHub?.publishMessage(published.threadId, published.message);
  return result;
}

function nestedSendReceipt(
  deps: BuildDeps,
  row: TodoRow,
  clientMessageId: string,
): { conversationId: string; delivered: ThreadMessageDelivery } | undefined {
  const ledgerId = nestedLedgerId(row.id, clientMessageId);
  const builds = deps.db.select({ id: build.id }).from(build).where(eq(build.todoId, row.id)).all();
  for (const candidate of builds) {
    const stored = storedDelivery(findClientMessage(deps.db, candidate.id, ledgerId));
    if (stored !== undefined) return stored;
  }
  return undefined;
}

function settleStoredSend(
  deps: BuildDeps,
  row: TodoRow,
  body: ThreadMessageBody,
  origin: ThreadMessageOrigin,
): ThreadMessageResult | undefined {
  const outer = findClientMessage<ThreadMessageResult>(deps.db, row.id, body.clientMessageId);
  if (outer !== undefined) return outer;
  const nested = nestedSendReceipt(deps, row, body.clientMessageId);
  if (nested === undefined) return undefined;
  try {
    recordInCoordinator(deps, row, body, nested, origin);
  } catch (error) {
    return replayAfterConflict<ThreadMessageResult>(deps.db, row.id, body.clientMessageId, error);
  }
  return { todoId: row.id, ...nested };
}

function bindRouteReceipt(
  deps: BuildDeps,
  row: TodoRow,
  body: ThreadMessageBody,
  origin: ThreadMessageOrigin,
  buildId: string,
): { write: () => void; publish: () => void } {
  let published: ReturnType<typeof insertCoordinatorMarker> | undefined;
  const write = () => {
    const sent = storedDelivery(
      findClientMessage(deps.db, buildId, nestedLedgerId(row.id, body.clientMessageId)),
    );
    if (sent === undefined) throw new Error('send receipt missing');
    claimClientMessage(deps.db, row.id, body.clientMessageId, { todoId: row.id, ...sent });
    published = insertCoordinatorMarker(deps, row, body, sent, origin);
  };
  return {
    write,
    publish: () => {
      if (published === undefined) return;
      deps.convHub?.publishMessage(published.threadId, published.message);
    },
  };
}

export async function messageThreadAsUser(
  deps: BuildDeps,
  teamId: string,
  todoId: string,
  body: ThreadMessageBody,
  origin: ThreadMessageOrigin = USER_ORIGIN,
): Promise<ThreadMessageResult> {
  const row = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), eq(todo.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `todo ${todoId}`);
  const stored = settleStoredSend(deps, row, body, origin);
  if (stored !== undefined) return stored;
  if (row.archivedAt !== null) throw new HttpError(409, 'Unarchive to continue');
  assertProjectWritable(deps.db, row.teamId, row.projectId);
  if (row.latestBuildId === null) {
    throw new HttpError(409, `thread #${row.seqNum} has not started yet`);
  }
  const buildId = row.latestBuildId;
  return coalesceClientMessage(deps.db, row.id, body.clientMessageId, async () => {
    const again = settleStoredSend(deps, row, body, origin);
    if (again !== undefined) return again;
    if (stoppedBeforeFirstRun(deps.db, row)) {
      try {
        return commitStoppedRestart(deps, row, body, origin);
      } catch (error) {
        return replayAfterConflict<ThreadMessageResult>(
          deps.db,
          row.id,
          body.clientMessageId,
          error,
        );
      }
    }
    const bound = bindRouteReceipt(deps, row, body, origin, buildId);
    const sent = await deliver(deps, row, buildId, body, origin, bound.write);
    bound.publish();
    const committed = findClientMessage<ThreadMessageResult>(deps.db, row.id, body.clientMessageId);
    if (committed !== undefined) return committed;
    try {
      recordInCoordinator(deps, row, body, sent, origin);
    } catch (error) {
      return replayAfterConflict<ThreadMessageResult>(deps.db, row.id, body.clientMessageId, error);
    }
    return { todoId: row.id, ...sent };
  });
}

export interface QuestionAnswerResult {
  todoId: string;
  buildId: string;
  requestId: string;
  delivered: 'held-step' | 'waiting-other-questions' | ThreadMessageDelivery;
}

export async function answerTaskQuestion(
  deps: BuildDeps,
  teamId: string,
  input: { todoId: string; requestId: string; answer: string },
  by: 'person' | 'coordinator',
): Promise<QuestionAnswerResult> {
  const row = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.id, input.todoId), eq(todo.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `todo ${input.todoId}`);
  if (row.archivedAt !== null) throw new HttpError(409, 'Unarchive to continue');
  assertProjectWritable(deps.db, row.teamId, row.projectId);
  if (row.latestBuildId === null) {
    throw new HttpError(409, `thread #${row.seqNum} has not started yet`);
  }
  const buildId = row.latestBuildId;
  const pending = pendingWorkerQuestions(deps.db, buildId);
  const question = pending.find((q) => q.requestId === input.requestId);
  if (question === undefined) {
    throw new HttpError(
      409,
      `requestId ${input.requestId} is not pending on thread #${row.seqNum}${pending.length > 0 ? `; pending: ${pending.map((q) => q.requestId).join(', ')}` : ''}`,
    );
  }
  const answer = { question, answer: input.answer, by };
  const result = { todoId: row.id, buildId, requestId: input.requestId };
  const running = hasClaimedStep(deps, buildId);
  const held = running && question.parkedAt === undefined;
  if (held || (!running && pending.length > 1)) {
    deps.db.transaction(() => settleQuestionAnswers(deps, buildId, [answer]));
    return { ...result, delivered: held ? 'held-step' : 'waiting-other-questions' };
  }
  const sent = await sendBuildSteer(
    deps,
    buildId,
    {
      content: `Answer to your question ${input.requestId}:\n${input.answer}`,
      clientMessageId: newRecordId(),
    },
    by === 'person'
      ? { human: true, afterTurn: true, answer }
      : { actor: 'Coordinator', afterTurn: true, answer },
  );
  return { ...result, buildId: sent.conversationId, delivered: sent.delivered };
}
