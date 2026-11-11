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
import { holdSecondRejectionRework } from './research-stuck.js';
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

function latestBuildOf(deps: BuildDeps, todoId: string): string | null {
  return (
    deps.db.select({ id: todo.latestBuildId }).from(todo).where(eq(todo.id, todoId)).get()?.id ??
    null
  );
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
      { human: true, afterTurn: true },
    );
    return { conversationId: sent.conversationId, delivered: sent.delivered };
  }
  if (running || row.phase === 'building' || row.phase === 'done') {
    const sent = await sendBuildSteer(
      deps,
      buildId,
      { content: body.content, clientMessageId: nestedId },
      origin.origin === 'user' ? { human: true } : { human: false, actor: origin.actor },
    );
    return { conversationId: sent.conversationId, delivered: sent.delivered };
  }
  if (row.phase === 'confirm' || row.phase === 'review') {
    const prior = findClientMessage(deps.db, buildId, nestedId);
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
      row.id,
    );
    if (prior === undefined) holdSecondRejectionRework(deps, buildId);
    return { conversationId: latestBuildOf(deps, row.id) ?? buildId, delivered: 'revision' };
  }
  if (row.phase === 'failed') {
    await applyBuildStepAction(
      deps,
      buildId,
      { action: 'restart', feedback: body.content, clientMessageId: nestedId },
      ...stepActionAttribution(origin),
      row.id,
    );
    return { conversationId: latestBuildOf(deps, row.id) ?? buildId, delivered: 'restart' };
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
    createdAt: nowMs(),
  };
  deps.db
    .insert(chiefMessage)
    .values({ ...message, threadId: thread.id, projectId: row.projectId })
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

function recoverRecordedBuildSend(
  deps: BuildDeps,
  row: TodoRow,
  body: ThreadMessageBody,
  origin: ThreadMessageOrigin,
): ThreadMessageResult | undefined {
  const builds = deps.db.select({ id: build.id }).from(build).where(eq(build.todoId, row.id)).all();
  const ledgerId = nestedLedgerId(row.id, body.clientMessageId);
  const matched = builds
    .map((candidate) => ({
      buildId: candidate.id,
      receipt: findClientMessage<{
        delivered?: ThreadMessageDelivery;
        nestedTodoId?: string;
        conversationId?: string;
      }>(deps.db, candidate.id, ledgerId),
    }))
    .find((item) => item.receipt?.nestedTodoId === row.id);
  const delivered = matched?.receipt?.delivered;
  const conversationId = matched?.receipt?.conversationId ?? row.latestBuildId;
  if (matched === undefined || delivered === undefined || conversationId == null) return undefined;
  if (delivered === 'revision') holdSecondRejectionRework(deps, matched.buildId);
  const sent = { conversationId, delivered };
  try {
    recordInCoordinator(deps, row, body, sent, origin);
  } catch (error) {
    return replayAfterConflict<ThreadMessageResult>(deps.db, row.id, body.clientMessageId, error);
  }
  return { todoId: row.id, ...sent };
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
  const replay = findClientMessage<ThreadMessageResult>(deps.db, row.id, body.clientMessageId);
  if (replay !== undefined) return replay;
  if (row.archivedAt !== null) throw new HttpError(409, 'Unarchive to continue');
  assertProjectWritable(deps.db, row.teamId, row.projectId);
  if (row.latestBuildId === null) {
    throw new HttpError(409, `thread #${row.seqNum} has not started yet`);
  }
  const buildId = row.latestBuildId;
  return coalesceClientMessage(deps.db, row.id, body.clientMessageId, async () => {
    const recovered = recoverRecordedBuildSend(deps, row, body, origin);
    if (recovered !== undefined) return recovered;
    if (stoppedBeforeFirstRun(deps.db, row)) {
      const stored = findClientMessage<ThreadMessageResult>(deps.db, row.id, body.clientMessageId);
      if (stored !== undefined) return stored;
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
    const sent = await deliver(deps, row, buildId, body, origin);
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
