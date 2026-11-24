import { isApprovalRequest } from '../chief/approval-card-model.js';
import type { ChiefQuestionItem } from '../chief/question-card.js';
import type { ChiefStreamItem } from '../fixtures/records.js';

export function pendingQuestions(stream: readonly ChiefStreamItem[]): ChiefQuestionItem[] {
  return stream.filter(
    (item): item is ChiefQuestionItem => item.kind === 'question' && item.status === 'pending',
  );
}

export function isDockedQuestion(question: ChiefQuestionItem): boolean {
  return question.parkedAt === undefined && !isApprovalRequest(question.requestId);
}

export function dockedQuestions(stream: readonly ChiefStreamItem[]): ChiefQuestionItem[] {
  return pendingQuestions(stream).filter(isDockedQuestion);
}
