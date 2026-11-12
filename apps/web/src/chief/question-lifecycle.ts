import type { ChiefStreamItem } from '../fixtures/records.js';
import type { ChiefQuestionItem } from './question-chips.js';

export const AWAITING_ANSWER_LABEL = '在等你回答';

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

export function answerLines(item: Pick<ChiefQuestionItem, 'status' | 'answers'>): string[] {
  if (item.status !== 'answered') return [];
  return (item.answers ?? [])
    .map((answer) => (answer.choices ?? []).join('、') || (answer.text ?? '').trim())
    .filter((part) => part !== '');
}
