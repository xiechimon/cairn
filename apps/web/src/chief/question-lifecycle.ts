import type { AskUserAnswer } from '@cairn/shared';
import type { ChiefStreamItem } from '../fixtures/records.js';
import type { ChiefQuestionItem } from './chief-question-card.js';

export const AWAITING_ANSWER_LABEL = '在等你回答';

export const QUESTION_FADE_MS = 200;

export function awaitingStream(
  stream: readonly ChiefStreamItem[],
  awaiting: boolean,
): readonly ChiefStreamItem[] {
  if (!awaiting) return stream;
  return stream.map((item) =>
    item.kind === 'streaming'
      ? {
          kind: 'streaming',
          label: AWAITING_ANSWER_LABEL,
          waiting: true,
          ...(item.tools !== undefined ? { tools: item.tools } : {}),
        }
      : item,
  );
}

export function answerSummary(item: ChiefQuestionItem): string {
  return (item.answers ?? [])
    .map((answer) => (answer.choices ?? []).join('、') || (answer.text ?? '').trim())
    .filter((part) => part !== '')
    .join('；');
}

export function leavingQuestion(
  last: ChiefQuestionItem | null,
  stream: readonly ChiefStreamItem[],
  settled: ReadonlyMap<string, AskUserAnswer[] | null>,
): ChiefQuestionItem | null {
  if (last === null) return null;
  const done = stream.find(
    (item): item is ChiefQuestionItem =>
      item.kind === 'question' && item.requestId === last.requestId && item.status !== 'pending',
  );
  if (done !== undefined) return done;
  if (!settled.has(last.requestId)) return null;
  return { ...last, status: 'answered', answers: settled.get(last.requestId) ?? null };
}
