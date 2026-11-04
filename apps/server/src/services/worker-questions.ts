import {
  ASK_USER_QUESTION_KIND,
  type AskUserQuestionContent,
  type MachineAskBody,
  type MachineAskResponse,
  THREAD_REPORT_LINE_MAX,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { build, message, type step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { postThreadReport } from './chief.js';
import { ASK_PARK_MS } from './chief-questions.js';
import { notifyTodoPhase } from './notifications.js';
import { setTodoPhase, type TodoDeps } from './todos.js';
import {
  answerPendingWorkerQuestions,
  readWorkerQuestion,
  writeWorkerQuestion,
} from './worker-question-store.js';

const POLL_MS = 400;

export const WORKER_ASK_PARKED_REASON =
  'The user has not answered yet. The question is parked on this thread and the answer will arrive as the next message on this same session. Say briefly that you are waiting for the answer, then end the turn; do not keep waiting.';

type StepRow = typeof step.$inferSelect;

function todoOfBuild(deps: TodoDeps, buildId: string): typeof todo.$inferSelect {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) throw new HttpError(404, `build ${buildId}`);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) throw new HttpError(404, `todo ${buildRow.todoId}`);
  return todoRow;
}

function parkedReply(content: AskUserQuestionContent): AskUserQuestionContent {
  return { ...content, status: 'cancelled', cancelReason: WORKER_ASK_PARKED_REASON };
}

function responseOf(requestId: string, content: AskUserQuestionContent): MachineAskResponse {
  return {
    status: content.status,
    requestId,
    answers: content.status === 'answered' ? (content.answers ?? null) : null,
    reason: content.status === 'cancelled' ? (content.cancelReason ?? null) : null,
  };
}

function openQuestion(
  deps: TodoDeps,
  row: StepRow,
  body: MachineAskBody,
): { content: AskUserQuestionContent; askedAt: number } {
  const stored = deps.db.select().from(message).where(eq(message.id, body.requestId)).get();
  if (stored !== undefined && stored.conversationId !== row.buildId) {
    throw new HttpError(409, 'question request id belongs to another conversation');
  }
  const existing = readWorkerQuestion(deps.db, row.buildId, body.requestId);
  if (stored !== undefined && existing !== null) {
    return { content: existing, askedAt: stored.createdAt };
  }
  const askedAt = nowMs();
  const content: AskUserQuestionContent = {
    kind: ASK_USER_QUESTION_KIND,
    requestId: body.requestId,
    status: 'pending',
    questions: body.questions,
    answers: null,
  };
  writeWorkerQuestion(deps, row.buildId, body.requestId, content, askedAt);
  const todoRow = todoOfBuild(deps, row.buildId);
  const record = setTodoPhase(deps, todoRow.id, todoRow.phase, { awaitingReply: true });
  if (record !== null) {
    notifyTodoPhase(deps, record, 'review', body.questions[0]?.question ?? null);
    postThreadReport(deps, record, 'review');
  }
  return { content, askedAt };
}

export async function askWorkerQuestion(
  deps: TodoDeps,
  row: StepRow,
  body: MachineAskBody,
  opts: { holdMs: number; signal?: AbortSignal },
): Promise<MachineAskResponse> {
  if (row.status !== 'claimed') throw new HttpError(409, 'ask_user requires a claimed step');
  const { content: first, askedAt } = openQuestion(deps, row, body);
  const deadline = Date.now() + Math.max(0, opts.holdMs);
  let content = first;
  for (;;) {
    if (content.status !== 'pending') return responseOf(body.requestId, content);
    if (content.parkedAt !== undefined) {
      return responseOf(body.requestId, parkedReply(content));
    }
    if (Date.now() - askedAt >= ASK_PARK_MS) {
      const parked: AskUserQuestionContent = { ...content, parkedAt: Date.now() };
      writeWorkerQuestion(deps, row.buildId, body.requestId, parked, askedAt);
      return responseOf(body.requestId, parkedReply(parked));
    }
    if (opts.signal?.aborted === true || Date.now() >= deadline) {
      return responseOf(body.requestId, content);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    content = readWorkerQuestion(deps.db, row.buildId, body.requestId) ?? content;
  }
}

export function settleWorkerReply(deps: TodoDeps, buildId: string, text: string): void {
  const todoRow = todoOfBuild(deps, buildId);
  if (!todoRow.awaitingReply) return;
  answerPendingWorkerQuestions(deps, buildId, text);
  setTodoPhase(deps, todoRow.id, todoRow.phase, { awaitingReply: false });
}

export function recordThreadReportLine(deps: TodoDeps, row: StepRow, line: unknown): string {
  if (typeof line !== 'string' || line.trim() === '') {
    throw new HttpError(400, 'thread_report expects a non-empty line');
  }
  const trimmed = line
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (trimmed.length > THREAD_REPORT_LINE_MAX) {
    throw new HttpError(
      400,
      `thread_report line is ${trimmed.length} characters; the limit is ${THREAD_REPORT_LINE_MAX}`,
    );
  }
  deps.db.update(build).set({ reportLine: trimmed }).where(eq(build.id, row.buildId)).run();
  return 'report line recorded';
}
