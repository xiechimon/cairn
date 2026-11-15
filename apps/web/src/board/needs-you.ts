import type { ChiefQuestionItem } from '../chief/question-chips.js';
import type { ChiefStreamItem } from '../fixtures/records.js';

export function pendingQuestions(stream: readonly ChiefStreamItem[]): ChiefQuestionItem[] {
  return stream.filter(
    (item): item is ChiefQuestionItem => item.kind === 'question' && item.status === 'pending',
  );
}
