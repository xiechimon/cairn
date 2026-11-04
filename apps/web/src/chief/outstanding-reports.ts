import type { ChiefStreamItem } from '../fixtures/records.js';

export function outstandingReportIds(stream: readonly ChiefStreamItem[]): ReadonlySet<string> {
  const newest = new Map<string, { id: string; phase: string }>();
  for (const item of stream) {
    if (item.kind === 'thread-report') newest.set(item.todoId, { id: item.id, phase: item.phase });
  }
  const ids = new Set<string>();
  for (const { id, phase } of newest.values()) {
    if (phase === 'needs-you') ids.add(id);
  }
  return ids;
}
