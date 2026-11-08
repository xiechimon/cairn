import type { ChiefQuestionItem } from '../chief/chief-question-card.js';
import type { ChiefStreamItem, TodoRecord } from '../fixtures/records.js';
import { threadStatus } from './thread-copy.js';

function actRank(todo: TodoRecord): number {
  if (todo.phase === 'needs_input' || todo.phase === 'confirm') return 0;
  return 1;
}

function waitsOnOwner(todo: TodoRecord): boolean {
  if (todo.waitingOn?.on === 'machine-update') return true;
  switch (todo.phase) {
    case 'confirm':
      return true;
    case 'review':
      return todo.output !== 'info';
    case 'needs_input':
    case 'failed':
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

function waitsOnCoordinator(todo: TodoRecord): boolean {
  const status = threadStatus(todo);
  return (status === 'needs-you' || status === 'failed') && !waitsOnOwner(todo);
}

export function inProgressThreads(todos: readonly TodoRecord[]): TodoRecord[] {
  return todos.filter(
    (todo) =>
      todo.archivedAt == null && (threadStatus(todo) === 'running' || waitsOnCoordinator(todo)),
  );
}

export function pendingQuestions(stream: readonly ChiefStreamItem[]): ChiefQuestionItem[] {
  return stream.filter(
    (item): item is ChiefQuestionItem => item.kind === 'question' && item.status === 'pending',
  );
}
