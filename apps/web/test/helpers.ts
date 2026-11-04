// Shared fixture factories for the web test dir (issue #73).
import { localTodo } from '../src/fixtures/fixtures.js';
import type { TodoRecord } from '../src/fixtures/records.js';

export const NOW = 1_758_000_000_000;

export function todo(seq: number, phase: TodoRecord['phase'], awaitingReply?: boolean): TodoRecord {
  const t = localTodo(seq, `task ${seq}`, NOW);
  return awaitingReply === undefined ? { ...t, phase } : { ...t, phase, awaitingReply };
}
