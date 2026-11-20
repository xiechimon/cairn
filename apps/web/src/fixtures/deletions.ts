import type { ScheduleRecord } from './records.js';

const closed = new Set<string>();

export function markClosed(id: string): void {
  closed.add(id);
}

export function withoutClosed<T extends { id: string }>(todos: T[]): T[] {
  return todos.filter((t) => !closed.has(t.id));
}

const createdSchedules: ScheduleRecord[] = [];
let createdSeq = 0;

export function markScheduleCreated(record: Omit<ScheduleRecord, 'id'>): void {
  createdSchedules.push({ ...record, id: `fixture-created-${++createdSeq}` });
}

export function withCreatedSchedules(schedules: ScheduleRecord[]): ScheduleRecord[] {
  return createdSchedules.length === 0 ? schedules : [...schedules, ...createdSchedules];
}
