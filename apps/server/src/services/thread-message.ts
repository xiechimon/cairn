import {
  redactSecrets,
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
  findClientMessage,
  replayAfterConflict,
} from './client-message.js';
import { assertProjectWritable } from './project-writable.js';
import { holdCodeThreadForPriorResearch } from './research-before-plan.js';
import { holdSecondRejectionRework } from './research-stuck.js';
import { answerWorkerQuestionsById, pendingWorkerQuestionIds } from './worker-question-store.js';

type TodoRow = typeof todo.$inferSelect;

export type ThreadMessageOrigin = { origin: 'user' } | { origin: 'coordinator'; actor: string };

const USER_ORIGIN: ThreadMessageOrigin = { origin: 'user' };

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
    assignment:
      row.assignment?.source === 'intake-label'
        ? {
            source: row.assignment.source,
            plan: row.assignment.plan,
            build: row.assignment.build,
          }
        : { plan: null, build: null },
    withPlan: false,
    triggerSource: origin.origin === 'user' ? 'user' : 'chief',
    prompt,
  });
  if (!started) throw new Error('build missing after start');
  holdCodeThreadForPriorResearch(deps, row.id, started.id);
  return started.id;
}

async function deliver(
  deps: BuildDeps,
  row: TodoRow,
  buildId: string,
  body: ThreadMessageBody,
  origin: ThreadMessageOrigin,
): Promise<{ conversationId: string; delivered: ThreadMessageDelivery }> {
  const running = hasClaimedStep(deps, buildId);
  if (running || row.phase === 'building' || row.phase === 'done') {
    const sent = await sendBuildSteer(
      deps,
      buildId,
      { content: body.content, clientMessageId: body.clientMessageId },
      origin.origin === 'user' ? { human: true } : { human: false, actor: origin.actor },
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
        clientMessageId: body.clientMessageId,
      },
      ...stepActionAttribution(origin),
    );
    holdSecondRejectionRework(deps, buildId);
    return { conversationId: latestBuildOf(deps, row.id) ?? buildId, delivered: 'revision' };
  }
  if (row.phase === 'failed') {
    await applyBuildStepAction(
      deps,
      buildId,
      { action: 'restart', feedback: body.content, clientMessageId: body.clientMessageId },
      ...stepActionAttribution(origin),
    );
    return { conversationId: latestBuildOf(deps, row.id) ?? buildId, delivered: 'restart' };
  }
  if (stoppedBeforeFirstRun(deps.db, row)) {
    return {
      conversationId: startThreadBuild(deps, row, origin, body.content),
      delivered: 'restart',
    };
  }
  throw new HttpError(409, `thread #${row.seqNum} cannot take a message while ${row.phase}`);
}

function recordInCoordinator(
  deps: BuildDeps,
  row: TodoRow,
  body: ThreadMessageBody,
  sent: { conversationId: string; delivered: ThreadMessageDelivery },
  origin: ThreadMessageOrigin,
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
    by: origin.origin,
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
    const parked = pendingWorkerQuestionIds(deps.db, buildId);
    const sent = await deliver(deps, row, buildId, body, origin);
    answerWorkerQuestionsById(deps, buildId, parked, body.content);
    try {
      recordInCoordinator(deps, row, body, sent, origin);
    } catch (error) {
      return replayAfterConflict<ThreadMessageResult>(deps.db, row.id, body.clientMessageId, error);
    }
    return { todoId: row.id, ...sent };
  });
}
