import type { ChiefStreamItem } from '../fixtures/records.js';

export interface TaskCardFacts {
  updates: number;
  latest: string | null;
}

export function taskCardFacts(stream: readonly ChiefStreamItem[], todoId: string): TaskCardFacts {
  let updates = 0;
  let latest: string | null = null;
  for (const item of stream) {
    if (item.kind !== 'thread-report' || item.todoId !== todoId) continue;
    updates += 1;
    latest = item.line ?? latest;
  }
  return { updates, latest };
}
