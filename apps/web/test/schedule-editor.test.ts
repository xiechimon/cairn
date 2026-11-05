import type { ScheduleRecord } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { mapSchedules } from '../src/api/mappers.js';
import type { ScheduleRecord as DisplaySchedule } from '../src/fixtures/records.js';
import { type TFunc, translate } from '../src/i18n/translate.js';
import { scheduleSummary } from '../src/pages/schedule-summary.js';
import { scheduleBody, scheduleDraft, scheduleTime, scheduleViewState } from '../src/schedules/schedule-model.js';

const NOW = Date.UTC(2026, 10, 4, 12);
const t: TFunc = (source, vars) => translate('zh', {}, source, vars);
const record: ScheduleRecord = {
  id: 'schedule-1', teamId: 'team-1', projectId: 'project-1', todoId: 'todo-1', kind: 'daily',
  cron: '0 9 * * *', prompt: 'Review the release', enabled: true, at: Date.UTC(2026, 10, 4, 1),
  tz: 'Asia/Shanghai', nextRunAt: NOW + 86_400_000, lastRunAt: NOW - 86_400_000,
  lastRunStatus: 'completed', pausedReason: null, createdBy: 'user-1',
  todo: { seqNum: 1, title: 'Release review', phase: 'done', projectName: 'cairn', ownerId: 'user-1' },
};

describe('schedule editor wire values', () => {
  test('schedule summaries use the saved timezone for the same raw anchor and next run', () => {
    const schedule: DisplaySchedule = { ...record, at: Date.UTC(2026, 10, 5, 14, 15), nextRunAt: Date.UTC(2026, 10, 5, 14, 15) };
    const now = Date.UTC(2026, 10, 5, 13);
    expect(scheduleSummary({ ...schedule, tz: 'America/New_York' }, now, t)).toBe('11月5日 09:15 每天运行 · 下次 今天 09:15');
    expect(scheduleSummary({ ...schedule, tz: 'Asia/Shanghai' }, now, t)).toBe('11月5日 22:15 每天运行 · 下次 今天 22:15');
  });
  test('Today follows the saved timezone across midnight rather than the fixed UTC+8 date', () => {
    const nextRunAt = Date.UTC(2026, 10, 5, 6, 15);
    const schedule: DisplaySchedule = { ...record, at: nextRunAt, nextRunAt, tz: 'America/New_York' };
    expect(scheduleSummary(schedule, Date.UTC(2026, 10, 5, 4, 30), t)).toBe('11月5日 01:15 每天运行 · 下次 11月5日 01:15');
    expect(scheduleSummary(schedule, Date.UTC(2026, 10, 5, 5, 30), t)).toBe('11月5日 01:15 每天运行 · 下次 今天 01:15');
  });
  test('actual mapped missing-next rows never show an epoch date in shared summaries', () => {
    const [schedule] = mapSchedules([{ ...record, kind: 'once', nextRunAt: null }]);
    expect(schedule).toBeDefined();
    if (schedule === undefined) throw new Error('Mapped schedule missing');
    expect(schedule.nextRunAt).toBe(0);
    expect(scheduleSummary(schedule, NOW, t)).toContain('No upcoming runs');
    expect(scheduleSummary(schedule, NOW, t)).not.toContain('1月1日');
    expect(scheduleSummary({ ...schedule, kind: 'daily' }, NOW, t)).toContain('Next run unavailable');
  });
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

  test('a new schedule defaults to the next civil date across spring DST without changing existing anchors', () => {
    const saturdayLate = Date.UTC(2026, 2, 8, 4, 30);
    expect(scheduleDraft(null, saturdayLate, 'America/New_York').date).toBe('2026-03-08');
    expect(scheduleDraft({ ...record, at: saturdayLate, tz: 'America/New_York' }, saturdayLate).date).toBe('2026-03-07');
    expect(scheduleDraft({ ...record, kind: 'cron', at: null, tz: 'America/New_York' }, saturdayLate).date).toBe('2026-03-09');
  });

});
