import {
  ASK_USER_QUESTION_KIND,
  type AskUserQuestionContent,
  type MachineAskBody,
  type MachineAskResponse,
  redactSecrets,
  type TaskDecision,
  THREAD_REPORT_LINE_MAX,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { build, message, type step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { tidyText } from '../lib/tidy-text.js';
import { recordAnswer } from './answer-delivery.js';
import { postThreadReport } from './chief.js';
import { ASK_PARK_MS } from './chief-questions.js';
import { reconcileOwners } from './owner.js';
import { getTodo, type TodoDeps } from './todos.js';
import {
  pendingWorkerQuestions,
  readWorkerQuestion,
  updateWorkerQuestion,
  writeWorkerQuestion,
} from './worker-question-store.js';

const POLL_MS = 400;

export const WORKER_ASK_PARKED_REASON =
  'No answer yet. The question is parked under its requestId; when it is answered, this same session resumes with the answer. Say briefly what you are waiting for, then end the turn; do not keep waiting.';

type StepRow = typeof step.$inferSelect;

function todoOfBuild(deps: TodoDeps, buildId: string): typeof todo.$inferSelect {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) throw new HttpError(404, `build ${buildId}`);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) throw new HttpError(404, `todo ${buildRow.todoId}`);
  return todoRow;
}

function questionReportLine(text: string | undefined): string | undefined {
  const clean = tidyText(redactSecrets(text ?? '').value as string);
  if (clean === '') return undefined;
  return clean.length > THREAD_REPORT_LINE_MAX
    ? `${clean.slice(0, THREAD_REPORT_LINE_MAX - 1)}…`
    : clean;
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
  if (stored !== undefined) {
    throw new HttpError(409, 'question request id belongs to another message');
  }
  const askedAt = nowMs();
  const content: AskUserQuestionContent = {
    kind: ASK_USER_QUESTION_KIND,
    requestId: body.requestId,
    status: 'pending',
    questions: body.questions,
    answers: null,
  };
  if (!writeWorkerQuestion(deps, row.buildId, body.requestId, content, askedAt)) {
    throw new HttpError(409, 'question request id belongs to another message');
  }
  const todoId = todoOfBuild(deps, row.buildId).id;
  reconcileOwners(deps, [todoId]);
  const record = getTodo(deps, todoId);
  if (record !== null) {
    deps.hub.publishTodoDoc(record.teamId, record);
    postThreadReport(deps, record, 'needs-you', questionReportLine(body.questions[0]?.question));
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
      updateWorkerQuestion(deps, row.buildId, body.requestId, parked, askedAt);
      return responseOf(body.requestId, parkedReply(parked));
    }
    if (opts.signal?.aborted === true || Date.now() >= deadline) {
      return responseOf(body.requestId, content);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    content = readWorkerQuestion(deps.db, row.buildId, body.requestId) ?? content;
  }
}

export interface QuestionAnswer {
  question: AskUserQuestionContent;
  answer: string;
  by: TaskDecision['by'];
}

export function settleWorkerReply(deps: TodoDeps, buildId: string, text: string): number {
  const answers = pendingWorkerQuestions(deps.db, buildId).map((question) => ({
    question,
    answer: text,
    by: 'person' as const,
  }));
  settleQuestionAnswers(deps, buildId, answers);
  return answers.length;
}

export function settleQuestionAnswers(
  deps: TodoDeps,
  buildId: string,
  answers: readonly QuestionAnswer[],
): void {
  if (answers.length === 0) return;
  for (const { question } of answers) {
    if (readWorkerQuestion(deps.db, buildId, question.requestId)?.status !== 'pending') {
      throw new HttpError(409, `requestId ${question.requestId} is no longer pending`);
    }
  }
  for (const { question, answer, by } of answers) {
    recordAnswer(deps, buildId, question.requestId, { text: answer, by });
  }
  const todoRow = todoOfBuild(deps, buildId);
  const at = nowMs();
  deps.db
    .update(todo)
    .set({
      decisions: [
        ...todoRow.decisions,
        ...answers.map(({ question, answer, by }) => ({
          requestId: question.requestId,
          question: question.questions.map((q) => q.question).join('\n'),
          answer,
          by,
          at,
        })),
      ],
      v: todoRow.v + 1,
    })
    .where(eq(todo.id, todoRow.id))
    .run();
  reconcileOwners(deps, [todoRow.id]);
  const record = getTodo(deps, todoRow.id);
  if (record) deps.hub.publishTodoDoc(record.teamId, record);
}

export function recordThreadReportLine(deps: TodoDeps, row: StepRow, line: unknown): string {
  const text = typeof line === 'string' ? tidyText(redactSecrets(line).value as string) : '';
  if (text === '') throw new HttpError(400, 'thread_report expects a non-empty line');
  if (text.length > THREAD_REPORT_LINE_MAX) {
    throw new HttpError(
      400,
      `thread_report line is ${text.length} characters; the limit is ${THREAD_REPORT_LINE_MAX}`,
    );
  }
  deps.db.update(build).set({ reportLine: text }).where(eq(build.id, row.buildId)).run();
  return 'report line recorded';
}
