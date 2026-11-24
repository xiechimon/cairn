import type { ChiefStreamItem } from '../fixtures/records.js';

export type ChiefQuestionItem = Extract<ChiefStreamItem, { kind: 'question' }>;

export type ChiefQuestionPrompt = ChiefQuestionItem['questions'][number];

export function recommendedFirst(question: ChiefQuestionPrompt): ChiefQuestionPrompt {
  return {
    ...question,
    options: [
      ...question.options.filter((option) => option.recommended === true),
      ...question.options.filter((option) => option.recommended !== true),
    ],
  };
}
