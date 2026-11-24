import type { ScheduleRecord } from './records.js';

export function withoutClosed<T extends { id: string }>(todos: T[]): T[] {
  return todos;
}

export function withCreatedSchedules(schedules: ScheduleRecord[]): ScheduleRecord[] {
  return schedules;
}
