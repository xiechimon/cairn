import type { ChiefStreamItem } from '../fixtures/records.js';
import type { ChiefQuestionItem } from './question-card.js';

export function awaitingStream(
  stream: readonly ChiefStreamItem[],
  awaiting: boolean,
): readonly ChiefStreamItem[] {
  if (!awaiting) return stream;
  return stream.filter((item) => item.kind !== 'streaming');
}

export function answerOf(
  item: Pick<ChiefQuestionItem, 'status' | 'answers'>,
  index: number,
): string | null {
  if (item.status !== 'answered') return null;
  const answer = item.answers?.[index];
  if (answer === undefined) return null;
  const text = (answer.choices ?? []).join('、') || (answer.text ?? '').trim();
  return text === '' ? null : text;
}
