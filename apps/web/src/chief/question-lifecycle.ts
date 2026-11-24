import type { AskUserAnswer } from '@cairn/shared';
import type { ChiefStreamItem } from '../fixtures/records.js';

export function awaitingStream(
  stream: readonly ChiefStreamItem[],
  awaiting: boolean,
): readonly ChiefStreamItem[] {
  if (!awaiting) return stream;
  return stream.filter((item) => item.kind !== 'streaming');
}

export function answerLineOf(answer: AskUserAnswer | undefined): string {
  if (answer === undefined) return '';
  return (answer.choices ?? []).join('、') || (answer.text ?? '').trim();
}
