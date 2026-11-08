import {
  type AskUserQuestionContent,
  type EscalationClass,
  escalationClassSchema,
  ownerDecides,
  QUESTION_DEADLINE_MS,
  redactSecrets,
} from '@cairn/shared';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { message, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { tidyText } from '../lib/tidy-text.js';
import type { BuildDeps } from './builds.js';
import { enqueueQuestionWake, postThreadReport } from './chief.js';
import { notifyTodoPhase } from './notifications.js';
import { answerTaskQuestion } from './thread-message.js';
import { pushWorkerQuestion } from './thread-push.js';
import { getTodo } from './todos.js';
import { pendingWorkerQuestions, updateWorkerQuestion } from './worker-question-store.js';

const SNIPPET_MAX = 120;
const WAITING_PHASES = ['needs_input', 'failed'] as const;

export const DEADLINE_WAKE_NOTE =
  'The answer deadline passed with no answer. Answer by rule now, or escalate_question with your default; if nothing happens by the next deadline the question goes to the user without a default.';

function questionText(question: AskUserQuestionContent): string {
  return tidyText(
    redactSecrets(question.questions.map((q) => q.question).join(' ')).value as string,
  );
}

function snippetOf(question: AskUserQuestionContent, defaultAnswer: string | null): string {
  const text =
    defaultAnswer === null
      ? `${questionText(question)} (no default: the Coordinator did not answer)`
      : `${questionText(question)} Default: ${tidyText(redactSecrets(defaultAnswer).value as string)}`;
  return text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX - 1)}…` : text;
}

function createdAtOf(deps: BuildDeps, buildId: string, requestId: string): number {
  return (
    deps.db
      .select({ createdAt: message.createdAt })
      .from(message)
      .where(and(eq(message.id, requestId), eq(message.conversationId, buildId)))
      .get()?.createdAt ?? nowMs()
  );
}

function raiseToOwner(
  deps: BuildDeps,
  todoId: string,
  buildId: string,
  question: AskUserQuestionContent,
  escalation: { class: EscalationClass; defaultAnswer: string | null },
  now: number,
): void {
  const applyAt =
    !ownerDecides(escalation.class) && escalation.defaultAnswer !== null
      ? now + QUESTION_DEADLINE_MS
      : null;
  updateWorkerQuestion(
    deps,
    buildId,
    question.requestId,
    { ...question, escalation: { ...escalation, at: now, applyAt } },
    createdAtOf(deps, buildId, question.requestId),
  );
  const record = getTodo(deps, todoId);
  if (record === null) return;
  deps.hub.publishTodoDoc(record.teamId, record);
  const snippet = snippetOf(question, escalation.defaultAnswer);
  notifyTodoPhase(deps, record, 'review', snippet);
  postThreadReport(deps, record, 'needs-you', snippet);
  pushWorkerQuestion(deps, buildId, snippet);
}

export function escalateQuestion(
  deps: BuildDeps,
  teamId: string,
  input: { todoId: string; requestId: string; class: string; defaultAnswer: string },
): { todoId: string; requestId: string; class: EscalationClass; appliesAt: number | null } {
  const parsedClass = escalationClassSchema.safeParse(input.class);
  if (!parsedClass.success) {
    throw new HttpError(
      400,
      'invalid params.class: expected design, payment, credential, intended-behavior or other',
    );
  }
  const row = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.id, input.todoId), eq(todo.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `todo ${input.todoId}`);
  const buildId = row.latestBuildId;
  const question =
    buildId === null
      ? undefined
      : pendingWorkerQuestions(deps.db, buildId).find((q) => q.requestId === input.requestId);
  if (buildId === null || question === undefined) {
    throw new HttpError(
      409,
      `requestId ${input.requestId} is not pending on thread #${row.seqNum}`,
    );
  }
  if (question.escalation !== undefined) {
    throw new HttpError(409, `requestId ${input.requestId} is already with the user`);
  }
  const now = nowMs();
  raiseToOwner(
    deps,
    row.id,
    buildId,
    question,
    { class: parsedClass.data, defaultAnswer: input.defaultAnswer },
    now,
  );
  const stored = pendingWorkerQuestions(deps.db, buildId).find(
    (q) => q.requestId === input.requestId,
  );
  return {
    todoId: row.id,
    requestId: input.requestId,
    class: parsedClass.data,
    appliesAt: stored?.escalation?.applyAt ?? null,
  };
}

function hasLiveStep(deps: BuildDeps, buildId: string): boolean {
  return (
    deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, buildId), eq(step.status, 'claimed')))
      .get() !== undefined
  );
}

export async function sweepQuestionDeadlines(
  deps: BuildDeps,
  now: number = nowMs(),
): Promise<void> {
  const rows = deps.db
    .select()
    .from(todo)
    .where(
      and(
        inArray(todo.phase, [...WAITING_PHASES]),
        isNull(todo.archivedAt),
        isNotNull(todo.latestBuildId),
      ),
    )
    .all();
  for (const row of rows) {
    const buildId = row.latestBuildId as string;
    if (hasLiveStep(deps, buildId)) continue;
    for (const question of pendingWorkerQuestions(deps.db, buildId)) {
      const escalation = question.escalation;
      if (escalation !== undefined) {
        if (
          escalation.applyAt !== null &&
          escalation.defaultAnswer !== null &&
          now >= escalation.applyAt
        ) {
          try {
            await answerTaskQuestion(
              deps,
              row.teamId,
              { todoId: row.id, requestId: question.requestId, answer: escalation.defaultAnswer },
              'coordinator',
            );
          } catch (error) {
            if (!(error instanceof HttpError)) throw error;
          }
        }
        continue;
      }
      const createdAt = createdAtOf(deps, buildId, question.requestId);
      const deadlineAt = question.deadlineAt ?? createdAt + QUESTION_DEADLINE_MS;
      if (now < deadlineAt) continue;
      if (question.remindedAt === undefined) {
        updateWorkerQuestion(
          deps,
          buildId,
          question.requestId,
          { ...question, remindedAt: now, deadlineAt: now + QUESTION_DEADLINE_MS },
          createdAt,
        );
        const record = getTodo(deps, row.id);
        if (record !== null) enqueueQuestionWake(deps, record, DEADLINE_WAKE_NOTE);
        continue;
      }
      raiseToOwner(deps, row.id, buildId, question, { class: 'other', defaultAnswer: null }, now);
    }
  }
}
