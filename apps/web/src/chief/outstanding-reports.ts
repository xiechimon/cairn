import type { ChiefStreamItem } from '../fixtures/records.js';

export function outstandingReportIds(stream: readonly ChiefStreamItem[]): ReadonlySet<string> {
  const newestQuestion = new Map<string, string>();
  for (const item of stream) {
    if (item.kind === 'thread-report' && item.phase === 'needs-you')
      newestQuestion.set(item.todoId, item.id);
  }
  return new Set(newestQuestion.values());
}
