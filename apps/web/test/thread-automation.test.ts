import type { ScheduleRecord } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  automationCadence,
  automationFinished,
  automationNextRun,
  automationsForThread,
} from '../src/board/thread-automation-model.js';
import { translate } from '../src/i18n/translate.js';

const NOW = Date.UTC(2026, 10, 4, 8);
const t = (source: string, vars?: Record<string, string | number>) => translate('en', {}, source, vars);

function schedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: 'schedule-1', teamId: 'team-1', projectId: 'project-1', todoId: 'todo-1',
    kind: 'daily', cron: '0 9 * * *', prompt: 'Run the tests', enabled: true,
    at: Date.UTC(2026, 10, 4, 1), tz: 'Asia/Shanghai', nextRunAt: NOW + 60_000,
    lastRunAt: NOW - 86_400_000, lastRunStatus: 'completed', pausedReason: null, createdBy: 'user-1',
    todo: { seqNum: 9, title: 'Tests', phase: 'building', projectName: 'cairn', ownerId: 'user-1' },
    ...overrides,
  };
}

describe('automationsForThread', () => {
  test('includes only the selected thread, including paused records', () => {
    const own = schedule();
    const paused = schedule({ id: 'paused', enabled: false });
    expect(automationsForThread([schedule({ todoId: 'other' }), own, paused], 'todo-1')).toEqual([own, paused]);
  });

  test('an empty or unrelated list does not invent a schedule', () => {
    expect(automationsForThread([], 'todo-1')).toEqual([]);
    expect(automationsForThread([schedule()], 'other')).toEqual([]);
  });
});

describe('automationFinished', () => {
  test('a completed once record with no future run is finished', () => {
    expect(automationFinished(schedule({ kind: 'once', enabled: false, nextRunAt: null }))).toBe(true);
  });

  test('a paused, failed, stopped or in-flight once record is not finished', () => {
    for (const status of ['failed', 'stopped', 'running', null]) {
      expect(automationFinished(schedule({ kind: 'once', enabled: false, nextRunAt: null, lastRunStatus: status }))).toBe(false);
    }
    expect(automationFinished(schedule({ kind: 'once', nextRunAt: null, lastRunStatus: 'completed', pausedReason: 'Task archived' }))).toBe(false);
    expect(automationFinished(schedule({ kind: 'once', nextRunAt: NOW + 1000 }))).toBe(false);
    expect(automationFinished(schedule({ enabled: false, nextRunAt: null }))).toBe(false);
  });
});

describe('automationCadence', () => {
  test('daily and weekly times use the schedule timezone', () => {
    expect(automationCadence(schedule(), 'en', t)).toBe('Every day at 09:00');
    expect(automationCadence(schedule({ kind: 'weekly' }), 'en', t)).toBe('Every Wednesday at 09:00');
    expect(automationCadence(schedule({ kind: 'daily', tz: 'UTC' }), 'en', t)).toBe('Every day at 01:00');
  });

  test('weekday cron has a readable cadence and other expressions remain exact', () => {
    expect(automationCadence(schedule({ kind: 'cron', at: null, cron: '30 9 * * 1-5' }), 'en', t)).toBe('Every weekday at 09:30');
    expect(automationCadence(schedule({ kind: 'cron', at: null, cron: '15 */2 * * *' }), 'en', t)).toBe('Cron: 15 */2 * * *');
  });

  test('missing anchors or invalid legacy timezones do not crash the header', () => {
    expect(automationCadence(schedule({ at: null }), 'en', t)).toBe('Schedule time unavailable');
    expect(automationCadence(schedule({ tz: 'invalid' }), 'en', t)).toBe('Schedule time unavailable');
  });
});


describe('automationNextRun', () => {
  test('nearby runs stay in minutes and later runs use rounded hours or days', () => {
    expect(automationNextRun(NOW, NOW, t)).toBe('Next run is due');
    expect(automationNextRun(NOW - 1000, NOW, t)).toBe('Next run is due');
    expect(automationNextRun(NOW + 1000, NOW, t)).toBe('Next run in 1 minute');
    expect(automationNextRun(NOW + 2 * 60_000, NOW, t)).toBe('Next run in 2 minutes');
    expect(automationNextRun(NOW + 3_600_000, NOW, t)).toBe('Next run in 1 hour');
    expect(automationNextRun(NOW + 86_400_000, NOW, t)).toBe('Next run in 1 day');
  });
});
