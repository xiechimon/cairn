import type { AskUserAnswer } from '@cairn/shared';
import type { ChiefStreamItem } from '../fixtures/records.js';

export function awaitingStream(stream: readonly ChiefStreamItem[]): readonly ChiefStreamItem[] {
  const asked = stream.findLastIndex(
    (item) => item.kind === 'question' && item.status === 'pending',
  );
  if (asked < 0 || stream.slice(asked + 1).some((item) => item.kind === 'user')) return stream;
  return stream.filter((item) => item.kind !== 'streaming');
}

export function answerLineOf(answer: AskUserAnswer | undefined): string {
  if (answer === undefined) return '';
  return (answer.choices ?? []).join('、') || (answer.text ?? '').trim();
}
