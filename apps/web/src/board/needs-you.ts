import type { ChiefQuestionItem } from '../chief/chief-question-card.js';
import type { ChiefStreamItem, TodoRecord } from '../fixtures/records.js';
import { threadStatus } from './thread-copy.js';

export const ACT_ORDER = ['needs-you', 'failed', 'review'] as const;

export function actRank(todo: TodoRecord): number {
  if (todo.awaitingReply === true || todo.phase === 'confirm') return 0;
  if (todo.phase === 'failed') return 1;
  return 2;
}

export function needsYouThreads(todos: readonly TodoRecord[]): TodoRecord[] {
  return todos
    .filter((todo) => {
      const status = threadStatus(todo);
      return (status === 'needs-you' || status === 'failed') && todo.archivedAt == null;
    })
    .sort((a, b) => actRank(a) - actRank(b) || b.phaseAt - a.phaseAt);
}

export function pendingQuestions(stream: readonly ChiefStreamItem[]): ChiefQuestionItem[] {
  return stream.filter(
    (item): item is ChiefQuestionItem => item.kind === 'question' && item.status === 'pending',
  );
}

export function needsYouCount(
  todos: readonly TodoRecord[],
  stream: readonly ChiefStreamItem[],
): number {
  return needsYouThreads(todos).length + pendingQuestions(stream).length;
}
