import type { ScheduleRecord } from './records.js';

const deleted = new Set<string>();

export function markDeleted(id: string): void {
  deleted.add(id);
}

const closed = new Set<string>();

export function markClosed(id: string): void {
  closed.add(id);
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
