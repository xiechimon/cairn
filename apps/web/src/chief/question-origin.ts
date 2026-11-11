import { pendingQuestions } from '../board/needs-you.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import type { ChiefQuestionItem } from './question-chips.js';

export interface OriginChiefQuestion {
  teamId: string;
  conversationId: string;
  origin: string;
  item: ChiefQuestionItem;
}

export function originChiefQuestions(
  stream: readonly ChiefStreamItem[],
  origin: { teamId: string; conversationId: string; title: string },
): OriginChiefQuestion[] {
  return pendingQuestions(stream).map((item) => ({
    teamId: origin.teamId,
    conversationId: origin.conversationId,
    origin: origin.title,
    item,
  }));
}
