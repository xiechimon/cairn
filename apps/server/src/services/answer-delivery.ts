import {
  type AnswerDeliveryVia,
  type AskUserAnswer,
  isBuildStepKind,
  type SteerAnswer,
  type StepKind,
  type TaskDecision,
} from '@cairn/shared';
import type { Db } from '../db/client.js';
import { nowMs } from '../lib/ids.js';
import {
  type StoreDeps,
  updateWorkerQuestion,
  type WorkerQuestionRow,
  workerQuestionRows,
} from './worker-question-store.js';

export function receivesAnswers(kind: StepKind): boolean {
  return kind === 'plan' || isBuildStepKind(kind);
}

function rowOf(db: Db, buildId: string, requestId: string): WorkerQuestionRow | null {
  return workerQuestionRows(db, buildId).find((row) => row.id === requestId) ?? null;
}

export function recordAnswer(
  deps: StoreDeps,
  buildId: string,
  requestId: string,
  answer: { text: string; by: TaskDecision['by'] },
): boolean {
  const row = rowOf(deps.db, buildId, requestId);
  if (row === null || row.content.status === 'answered') return false;
  const answers: AskUserAnswer[] = row.content.questions.map((question) => ({
    header: question.header,
    text: answer.text,
  }));
  const { cancelReason: _cancelled, ...rest } = row.content;
  updateWorkerQuestion(
    deps,
    buildId,
    requestId,
    {
      ...rest,
      status: 'answered',
      answers,
      answeredAt: nowMs(),
      answeredBy: answer.by,
      deliveredAt: null,
    },
    row.createdAt,
  );
  return true;
}

export function markDelivered(
  deps: StoreDeps,
  buildId: string,
  requestIds: readonly string[],
  via: AnswerDeliveryVia,
  stepId: string,
): string[] {
  const marked: string[] = [];
  for (const requestId of new Set(requestIds)) {
    const row = rowOf(deps.db, buildId, requestId);
    if (row === null || row.content.status !== 'answered' || row.content.deliveredAt !== null) {
      continue;
    }
    updateWorkerQuestion(
      deps,
      buildId,
      requestId,
      { ...row.content, deliveredAt: nowMs(), deliveredVia: via, deliveredStepId: stepId },
      row.createdAt,
    );
    marked.push(requestId);
  }
  return marked;
}

function answerText(answers: readonly AskUserAnswer[] | null): string {
  const texts = (answers ?? []).map((answer) => answer.text ?? (answer.choices ?? []).join(', '));
  return [...new Set(texts)].join('\n');
}

export function undeliveredAnswers(db: Db, buildId: string): SteerAnswer[] {
  return workerQuestionRows(db, buildId)
    .filter((row) => row.content.status === 'answered' && row.content.deliveredAt === null)
    .sort(
      (a, b) =>
        (a.content.answeredAt ?? a.createdAt) - (b.content.answeredAt ?? b.createdAt) ||
        a.createdAt - b.createdAt,
    )
    .map((row) => ({ requestId: row.id, text: answerText(row.content.answers) }));
}
