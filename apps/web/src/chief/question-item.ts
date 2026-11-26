import type { ChiefStreamItem } from '../fixtures/records.js';
import { isApprovalRequest } from './approval-card-model.js';

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

export function plainQuestionText(item: ChiefQuestionItem): string | null {
  const [only, ...rest] = item.questions;
  if (isApprovalRequest(item.requestId) || only === undefined || rest.length > 0) return null;
  return only.options.length === 0 ? only.question : null;
}
