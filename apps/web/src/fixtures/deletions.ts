import type { ScheduleRecord, TodoRecord } from './records.js';

const deleted = new Set<string>();

export function markDeleted(id: string): void {
  deleted.add(id);
}

const closed = new Set<string>();
const threadListeners = new Set<() => void>();

export function subscribeFixtureThreads(listener: () => void): () => void {
  threadListeners.add(listener);
  return () => {
    threadListeners.delete(listener);
  };
}

function notifyThreads(): void {
  for (const listener of threadListeners) listener();
}

export function markClosed(id: string): void {
  closed.add(id);
  notifyThreads();
}

const resolved = new Set<string>();

export function markResolved(id: string): void {
  resolved.add(id);
  notifyThreads();
}

export function withResolved<T extends { id: string; phase: TodoRecord['phase'] }>(
  todos: T[],
): T[] {
  return resolved.size === 0
    ? todos
    : todos.map((todo) => (resolved.has(todo.id) ? { ...todo, phase: 'done' as const } : todo));
}

export function isDeleted(id: string): boolean {
  return deleted.has(id);
}

export function withoutDeleted<T extends { id: string }>(todos: T[]): T[] {
  return todos.filter((t) => !deleted.has(t.id) && !closed.has(t.id));
}

const createdSchedules: ScheduleRecord[] = [];
let createdSeq = 0;

export function markScheduleCreated(record: Omit<ScheduleRecord, 'id'>): void {
  createdSchedules.push({ ...record, id: `fixture-created-${++createdSeq}` });
}

export function withCreatedSchedules(schedules: ScheduleRecord[]): ScheduleRecord[] {
  return createdSchedules.length === 0 ? schedules : [...schedules, ...createdSchedules];
}

const archivedOverrides = new Map<string, boolean>();

export function markArchived(id: string): void {
  archivedOverrides.set(id, true);
  notifyThreads();
}

export function markUnarchived(id: string): void {
  archivedOverrides.set(id, false);
  notifyThreads();
}

export function isThreadArchived(todo: { id: string; archivedAt?: number | null }): boolean {
  return archivedOverrides.get(todo.id) ?? todo.archivedAt != null;
}

const renamed = new Map<string, string>();

export function markRenamed(id: string, title: string): void {
  renamed.set(id, title);
}

export function withRenamedTitles<T extends { id: string; title: string }>(todos: T[]): T[] {
  return renamed.size === 0
    ? todos
    : todos.map((todo) => ({ ...todo, title: renamed.get(todo.id) ?? todo.title }));
}
