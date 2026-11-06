import type { TodoRecord } from '../fixtures/records.js';
import { type ThreadStatus, threadStatus } from './thread-copy.js';

export interface ProjectThreads {
  live: TodoRecord[];
  earlier: TodoRecord[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type ElapsedUnit = 'm' | 'h' | 'd';

const LIVE_RANK: Partial<Record<ThreadStatus, number>> = {
  'needs-you': 0,
  failed: 1,
  running: 2,
};

function liveRank(todo: TodoRecord): number {
  return LIVE_RANK[threadStatus(todo)] ?? LIVE_RANK.running ?? 2;
}

export function projectThreads(todos: readonly TodoRecord[], projectId: string): ProjectThreads {
  const live: TodoRecord[] = [];
  const earlier: TodoRecord[] = [];
  for (const todo of todos) {
    if (todo.projectId !== projectId || todo.archivedAt != null) continue;
    const status = threadStatus(todo);
    const inProgress = status === 'running' || status === 'needs-you' || status === 'failed';
    (inProgress && todo.snoozeMode == null ? live : earlier).push(todo);
  }
  live.sort((a, b) => liveRank(a) - liveRank(b) || b.phaseAt - a.phaseAt);
  earlier.sort((a, b) => b.phaseAt - a.phaseAt);
  return { live, earlier };
}

export function elapsedSince(since: number, now: number): { n: number; unit: ElapsedUnit } | null {
  const diff = now - since;
  if (diff < MINUTE) return null;
  if (diff < HOUR) return { n: Math.floor(diff / MINUTE), unit: 'm' };
  if (diff < DAY) return { n: Math.floor(diff / HOUR), unit: 'h' };
  return { n: Math.floor(diff / DAY), unit: 'd' };
}
