import type { ScheduleRecord } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { streamEventQueryEffect } from '../src/api/sse-team-events.js';
import {
  previewCronNextRun,
  scheduleBody,
  scheduleDraft,
  scheduleEnded,
} from '../src/schedules/schedule-model.js';

const NOW = Date.UTC(2026, 10, 4, 12, 23);

const baseRecord: ScheduleRecord = {
  id: 'schedule-1',
  teamId: 'team-1',
  projectId: 'project-1',
  todoId: 'todo-1',
  kind: 'daily',
  cron: '0 9 * * *',
  prompt: 'Inspect release',
  enabled: true,
  at: Date.UTC(2026, 10, 4, 1, 0),
  tz: 'Asia/Shanghai',
  nextRunAt: NOW + 86_400_000,
  lastRunAt: null,
  lastRunStatus: null,
  lastRunError: null,
  pausedReason: null,
  triggerSpec: null,
  webhookMasked: null,
  webhookLastUsedAt: null,
  missedRunWindowMs: null,
  createdAt: NOW - 86_400_000,
  createdBy: 'user-1',
  todo: {
    seqNum: 1,
    title: 'Release review',
    phase: 'done',
    projectName: 'cairn',
    ownerId: 'user-1',
  },
};

describe('paused one-shot schedule classification', () => {
  test('manually paused once schedules stay in the active list instead of moving to ended', () => {
    expect(
      scheduleEnded({
        kind: 'once',
        enabled: false,
        nextRunAt: null,
        lastRunAt: null,
        lastRunStatus: null,
        pausedReason: null,
      }),
    ).toBe(false);
    expect(
      scheduleEnded({
        kind: 'once',
        enabled: false,
        nextRunAt: NOW + 3_600_000,
        lastRunAt: null,
        lastRunStatus: null,
        pausedReason: null,
      }),
    ).toBe(false);
  });

  test('finished or auto-disabled once schedules with no next run still classify as ended', () => {
    expect(
      scheduleEnded({
        kind: 'once',
        enabled: true,
        nextRunAt: null,
        lastRunAt: NOW - 60_000,
        lastRunStatus: 'completed',
        pausedReason: null,
      }),
    ).toBe(true);
    expect(
      scheduleEnded({
        kind: 'once',
        enabled: false,
        nextRunAt: null,
        lastRunAt: NOW - 60_000,
        lastRunStatus: 'completed',
        pausedReason: null,
      }),
    ).toBe(true);
    expect(
      scheduleEnded({
        kind: 'once',
        enabled: false,
        nextRunAt: null,
        lastRunAt: null,
        lastRunStatus: 'failed',
        pausedReason: 'Task archived',
      }),
    ).toBe(true);
  });
});

describe('weekly weekday picker and DST-safe anchors', () => {
  test('weekly draft reads the saved weekday in the schedule timezone and updates the anchor when changed', () => {
    const fridayShanghai = Date.UTC(2026, 10, 5, 20, 15);
    const weeklyRecord: ScheduleRecord = {
      ...baseRecord,
      kind: 'weekly',
      at: fridayShanghai,
      cron: '15 4 * * 5',
      tz: 'Asia/Shanghai',
    };
    const draft = scheduleDraft(weeklyRecord, NOW);
    expect(draft.trigger).toBe('weekly');
    expect(draft.weekday).toBe(5);
    expect(scheduleBody(draft, weeklyRecord, NOW)).toMatchObject({
      kind: 'weekly',
      at: fridayShanghai,
    });

    const moved = scheduleBody({ ...draft, weekday: 1, hour: '10', minute: '30' }, weeklyRecord, NOW);
    expect(moved.kind).toBe('weekly');
    if (moved.kind !== 'weekly') throw new Error('expected weekly body');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(moved.at);
    const get = (type: string) => parts.find((part) => part.type === type)?.value;
    expect(get('weekday')).toBe('Mon');
    expect(get('hour')).toBe('10');
    expect(get('minute')).toBe('30');
  });

  test('daily and weekly schedules survive a spring-forward DST default date without throwing', () => {
    const beforeDst = Date.UTC(2026, 2, 8, 4, 30);
    const fresh = scheduleDraft(null, beforeDst, 'America/New_York');
    expect(fresh.date).toBe('2026-03-08');
    const dailyBody = scheduleBody(
      { ...fresh, trigger: 'daily', hour: '02', minute: '30' },
      { ...baseRecord, tz: 'America/New_York' },
      beforeDst,
    );
    expect(dailyBody.kind).toBe('daily');
    if (dailyBody.kind !== 'daily') throw new Error('expected daily');
    const dailyParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(dailyBody.at);
    expect(dailyParts.find((part) => part.type === 'hour')?.value).toBe('02');
    expect(dailyParts.find((part) => part.type === 'minute')?.value).toBe('30');

    const weeklyBody = scheduleBody(
      { ...fresh, trigger: 'weekly', weekday: 0, hour: '02', minute: '30' },
      { ...baseRecord, tz: 'America/New_York' },
      beforeDst,
    );
    expect(weeklyBody.kind).toBe('weekly');
    if (weeklyBody.kind !== 'weekly') throw new Error('expected weekly');
    const weeklyParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(weeklyBody.at);
    expect(weeklyParts.find((part) => part.type === 'weekday')?.value).toBe('Sun');
    expect(weeklyParts.find((part) => part.type === 'hour')?.value).toBe('02');
    expect(weeklyParts.find((part) => part.type === 'minute')?.value).toBe('30');
  });
});

describe('non-quarter-hour minute editing and cron defaults', () => {
  test('editing a saved off-grid once schedule preserves its exact minute', () => {
    const futureOffGrid = NOW + 2 * 86_400_000;
    const onceRecord: ScheduleRecord = {
      ...baseRecord,
      kind: 'once',
      at: Date.UTC(2026, 10, 6, 1, 7),
      cron: null,
      nextRunAt: Date.UTC(2026, 10, 6, 1, 7),
      tz: 'Asia/Shanghai',
    };
    const draft = scheduleDraft(onceRecord, NOW);
    expect(draft.minute).toBe('07');
    expect(scheduleBody(draft, onceRecord, NOW)).toMatchObject({
      kind: 'once',
      at: onceRecord.at,
    });
    void futureOffGrid;
  });

  test('opening a cron schedule with null anchor defaults to on-grid 09:00 so switching to once never fails minute validation', () => {
    const cronRecord: ScheduleRecord = {
      ...baseRecord,
      kind: 'cron',
      at: null,
      cron: '*/20 8-17 * * MON-FRI',
    };
    const draft = scheduleDraft(cronRecord, NOW);
    expect(draft.hour).toBe('09');
    expect(draft.minute).toBe('00');
  });
});

describe('cron next-run preview and localized validation', () => {
  test('computes the next run timestamp for valid five-field cron expressions in the schedule timezone', () => {
    const from = Date.parse('2026-10-30T08:30:00+08:00');
    const result = previewCronNextRun('30 8 * * 1-5', 'Asia/Shanghai', from);
    expect(result).toEqual({
      ok: true,
      nextRunAt: Date.parse('2026-11-02T08:30:00+08:00'),
    });

    const named = previewCronNextRun('*/20 8-17 * * MON-FRI', 'Asia/Shanghai', from);
    expect(named).toEqual({
      ok: true,
      nextRunAt: Date.parse('2026-10-30T08:40:00+08:00'),
    });
  });

  test('returns localized error keys for invalid field counts, out-of-range fields, and impossible dates', () => {
    expect(previewCronNextRun('* *', 'UTC', NOW)).toEqual({
      ok: false,
      errorKey: 'Cron 需要 5 段：分 时 日 月 周。',
    });
    expect(previewCronNextRun('61 * * * *', 'UTC', NOW)).toEqual({
      ok: false,
      errorKey: '分钟段只能填 0–59 的数值或表达式。',
    });
    expect(previewCronNextRun('0 25 * * *', 'UTC', NOW)).toEqual({
      ok: false,
      errorKey: '小时段只能填 0–23 的数值或表达式。',
    });
    expect(previewCronNextRun('0 0 31 2 *', 'UTC', NOW)).toEqual({
      ok: false,
      errorKey: '这个 Cron 表达式不会匹配任何有效日期。',
    });
  });
});

describe('schedule SSE query invalidation', () => {
  test('schedule team SSE event cancels schedules query and ignores unrelated queries', () => {
    expect(
      streamEventQueryEffect({ type: 'schedule', teamId: 'team-1' }, ['schedules']),
    ).toBe('cancel');
    expect(
      streamEventQueryEffect({ type: 'schedule', teamId: 'team-1' }, ['todos', 'team-1']),
    ).toBe('ignore');
  });
});
