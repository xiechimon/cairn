import type { TodoRecord } from '../fixtures/records.js';
import { type ThreadStatus, threadStatus } from './thread-copy.js';

export interface ThreadGroups {
  needsYou: TodoRecord[];
  running: TodoRecord[];
  done: TodoRecord[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type ElapsedUnit = 'm' | 'h' | 'd';

const NEEDS_YOU_RANK: Partial<Record<ThreadStatus, number>> = { 'needs-you': 0, failed: 1 };
const RUNNING_RANK: Partial<Record<ThreadStatus, number>> = { running: 0, idle: 1 };

function needsYouRank(todo: TodoRecord): number {
  return NEEDS_YOU_RANK[threadStatus(todo)] ?? 0;
}

function runningRank(todo: TodoRecord): number {
  if (todo.snoozeMode != null) return 2;
  return RUNNING_RANK[threadStatus(todo)] ?? 0;
}

export function groupThreads(todos: readonly TodoRecord[], projectId: string | null): ThreadGroups {
  const groups: ThreadGroups = { needsYou: [], running: [], done: [] };
  for (const todo of todos) {
    if (todo.archivedAt != null || (projectId !== null && todo.projectId !== projectId)) continue;
    const status = threadStatus(todo);
    if (status === 'done') groups.done.push(todo);
    else if ((status === 'needs-you' || status === 'failed') && todo.snoozeMode == null) {
      groups.needsYou.push(todo);
    } else groups.running.push(todo);
  }
  groups.needsYou.sort((a, b) => needsYouRank(a) - needsYouRank(b) || b.phaseAt - a.phaseAt);
  groups.running.sort((a, b) => runningRank(a) - runningRank(b) || b.phaseAt - a.phaseAt);
  groups.done.sort((a, b) => b.phaseAt - a.phaseAt);
  return groups;
}

export function elapsedSince(since: number, now: number): { n: number; unit: ElapsedUnit } | null {
  const diff = now - since;
  if (diff < MINUTE) return null;
  if (diff < HOUR) return { n: Math.floor(diff / MINUTE), unit: 'm' };
  if (diff < DAY) return { n: Math.floor(diff / HOUR), unit: 'h' };
  return { n: Math.floor(diff / DAY), unit: 'd' };
}
