import { useSyncExternalStore } from 'react';
import { useOptionalChiefRoot } from '../chief/chief-root.js';
import type { OriginChiefQuestion } from '../chief/question-origin.js';
import type { TodoRecord } from '../fixtures/records.js';
import { needsYouThreads } from './needs-you.js';

type Listener = () => void;

let answered: ReadonlySet<string> = new Set();
const listeners = new Set<Listener>();

function answerKeyOf(todo: TodoRecord): string {
  return `${todo.id}:${todo.ask?.requestId ?? todo.phaseAt}`;
}

export const answeredThreads = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot(): ReadonlySet<string> {
    return answered;
  },
  mark(todo: TodoRecord): void {
    answered = new Set([...answered, answerKeyOf(todo)]);
    for (const listener of listeners) listener();
  },
};

export interface NeedsYou {
  threads: TodoRecord[];
  questions: OriginChiefQuestion[];
  count: number;
}

export function useNeedsYou(todos: readonly TodoRecord[]): NeedsYou {
  const root = useOptionalChiefRoot();
  const done = useSyncExternalStore(
    answeredThreads.subscribe,
    answeredThreads.snapshot,
    answeredThreads.snapshot,
  );
  const threads = needsYouThreads(todos).filter((todo) => !done.has(answerKeyOf(todo)));
  const questions = root?.pendingQuestions ?? [];
  return { threads, questions, count: threads.length + questions.length };
}
