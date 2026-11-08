import type { ChiefQuestionItem } from '../chief/chief-question-card.js';
import type { ChiefStreamItem, TodoRecord } from '../fixtures/records.js';

export const ACT_ORDER = ['needs-you', 'failed', 'review'] as const;

export function actRank(todo: TodoRecord): number {
  if (todo.phase === 'needs_input' || todo.phase === 'confirm') return 0;
  return 1;
}

function waitsOnOwner(todo: TodoRecord): boolean {
  switch (todo.phase) {
    case 'confirm':
      return true;
    case 'review':
      return todo.output !== 'info';
    case 'needs_input':
      return todo.waitingOn?.on === 'owner';
    default:
      return false;
  }
}

export function needsYouThreads(todos: readonly TodoRecord[]): TodoRecord[] {
  return todos
    .filter((todo) => todo.archivedAt == null && waitsOnOwner(todo))
    .sort((a, b) => actRank(a) - actRank(b) || b.phaseAt - a.phaseAt);
}

export function pendingQuestions(stream: readonly ChiefStreamItem[]): ChiefQuestionItem[] {
  return stream.filter(
    (item): item is ChiefQuestionItem => item.kind === 'question' && item.status === 'pending',
  );
}

export function needsYouCount(todos: readonly TodoRecord[], pendingQuestionCount = 0): number {
  return needsYouThreads(todos).length + pendingQuestionCount;
}

export const TRAY_PINNED = 3;

export function trayWindow<T>(
  entries: readonly T[],
  open: boolean,
): { shown: readonly T[]; more: number } {
  return {
    shown: open ? entries : entries.slice(0, TRAY_PINNED),
    more: Math.max(0, entries.length - TRAY_PINNED),
  };
}
