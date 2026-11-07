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
  requestId: string | null,
  stream: readonly ChiefStreamItem[],
): ChiefQuestionItem | null {
  if (requestId === null) return null;
  return (
    stream.find(
      (item): item is ChiefQuestionItem =>
        item.kind === 'question' && item.requestId === requestId && item.status !== 'pending',
    ) ?? null
  );
}
