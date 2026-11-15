import type { ChiefStreamItem } from '../fixtures/records.js';
import type { ChiefQuestionItem } from './question-chips.js';

export function awaitingStream(
  stream: readonly ChiefStreamItem[],
  awaiting: boolean,
): readonly ChiefStreamItem[] {
  if (!awaiting) return stream;
  return stream.filter((item) => item.kind !== 'streaming');
}

export function answerLines(item: Pick<ChiefQuestionItem, 'status' | 'answers'>): string[] {
  if (item.status !== 'answered') return [];
  return (item.answers ?? [])
    .map((answer) => (answer.choices ?? []).join('、') || (answer.text ?? '').trim())
    .filter((part) => part !== '');
}
