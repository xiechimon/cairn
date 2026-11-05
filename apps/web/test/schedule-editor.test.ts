import type { ScheduleRecord } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { scheduleBody, scheduleDraft, scheduleTime, scheduleViewState } from '../src/schedules/schedule-model.js';

const NOW = Date.UTC(2026, 10, 4, 12);
const record: ScheduleRecord = {
  id: 'schedule-1', teamId: 'team-1', projectId: 'project-1', todoId: 'todo-1', kind: 'daily',
  cron: '0 9 * * *', prompt: 'Review the release', enabled: true, at: Date.UTC(2026, 10, 4, 1),
  tz: 'Asia/Shanghai', nextRunAt: NOW + 86_400_000, lastRunAt: NOW - 86_400_000,
  lastRunStatus: 'completed', pausedReason: null, createdBy: 'user-1',
  todo: { seqNum: 1, title: 'Release review', phase: 'done', projectName: 'cairn', ownerId: 'user-1' },
};

describe('schedule editor wire values', () => {
  test('recognizes weekdays and retains a custom expression without rewriting it', () => {
    expect(scheduleDraft({ ...record, kind: 'cron', cron: '15 8 * * 1-5' }, NOW).trigger).toBe('weekdays');
    const custom = scheduleDraft({ ...record, kind: 'cron', at: null, cron: '*/20 8-17 * * MON-FRI' }, NOW);
    expect(custom.trigger).toBe('custom');
    expect(custom.cron).toBe('*/20 8-17 * * MON-FRI');
  });
  test('weekdays use the real cron input variant and preserve the saved prompt and pause state', () => {
    const body = scheduleBody({ ...scheduleDraft(record, NOW), trigger: 'weekdays', hour: '08', minute: '15' }, { ...record, enabled: false }, NOW);
    expect(body).toEqual({ todoId: 'todo-1', projectId: 'project-1', tz: 'Asia/Shanghai', prompt: 'Review the release', enabled: false, kind: 'cron', cron: '15 8 * * 1-5' });
  });
  test('custom cron is trimmed and sent without a made-up client parser', () => {
    const body = scheduleBody({ ...scheduleDraft(record, NOW), trigger: 'custom', cron: '  */20 8-17 * * MON-FRI  ' }, record, NOW);
    expect(body).toMatchObject({ kind: 'cron', cron: '*/20 8-17 * * MON-FRI' });
    expect(() => scheduleBody({ ...scheduleDraft(record, NOW), trigger: 'custom', cron: '* *' }, record, NOW)).toThrow('Use five cron fields');
  });
  test('named timezone converts its wall clock rather than the browser timezone', () => {
    expect(scheduleTime('2026-11-05', '09', '15', 'Asia/Shanghai')).toBe(Date.UTC(2026, 10, 5, 1, 15));
    expect(scheduleTime('2026-11-05', '09', '15', 'America/New_York')).toBe(Date.UTC(2026, 10, 5, 14, 15));
  });
  test('invalid calendar values and skipped DST wall clocks stay invalid', () => {
    expect(scheduleTime('2026-02-30', '09', '00', 'UTC')).toBeNull();
    expect(scheduleTime('2026-03-08', '02', '30', 'America/New_York')).toBeNull();
  });
  test('past one-time values are rejected without silently changing the chosen date', () => {
    expect(() => scheduleBody({ ...scheduleDraft(record, NOW), trigger: 'once', date: '2026-11-04', hour: '09', minute: '00' }, record, NOW)).toThrow('Choose a future time');
  });
  test('a finished once row is distinct from a paused or auto-disabled row', () => {
    expect(scheduleViewState({ ...record, kind: 'once', nextRunAt: null })).toBe('finished');
    expect(scheduleViewState({ ...record, enabled: false })).toBe('paused');
    expect(scheduleViewState({ ...record, enabled: false, pausedReason: 'Host removed' })).toBe('disabled');
  });
  test('a completed once row paused during its run stays finished when it has no pause reason', () => {
    const finished = { ...record, kind: 'once' as const, nextRunAt: null, enabled: false };
    expect(scheduleViewState(finished)).toBe('finished');
    expect(scheduleViewState({ ...finished, pausedReason: 'Host removed' })).toBe('disabled');
  });
  test('editing a saved off-grid minute preserves it without expanding the form choices', () => {
    const offGrid = { ...record, at: Date.UTC(2026, 10, 4, 1, 7), cron: '7 9 * * *' };
    const draft = scheduleDraft(offGrid, NOW);
    expect(draft.minute).toBe('07');
    expect(scheduleBody(draft, offGrid, NOW)).toMatchObject({ kind: 'daily', at: offGrid.at });
  });

});
