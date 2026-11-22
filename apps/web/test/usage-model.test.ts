import type { DailyUsageDay } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { DAILY_USAGE_MAX_DAYS } from '@cairn/shared';
import { USAGE_WEEKS, usageGrid, usageSummary } from '../src/usage/usage-model.js';

const day = (date: string, over: Partial<DailyUsageDay> = {}): DailyUsageDay => ({
  date,
  coordinator: 0,
  tasks: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  models: {},
  projects: {},
  todos: [],
  cost: null,
  ...over,
});

describe('usageGrid', () => {
  it('lays a full year of weeks ending on today inside what the server returns', () => {
    const grid = usageGrid(
      [day('2025-11-17', { coordinator: 5 }), day('2026-11-18', { tasks: 900 })],
      '2026-11-18',
    );
    expect(grid.weeks).toHaveLength(USAGE_WEEKS);
    expect(grid.days).toBeLessThanOrEqual(DAILY_USAGE_MAX_DAYS);
    expect(grid.from).toBe('2025-11-17');
    expect(grid.monthStarts.slice(0, 3)).toEqual([null, null, 12]);
    const cells = grid.weeks.flat();
    expect(cells[0]?.date).toBe('2025-11-17');
    expect(cells.find((cell) => cell.date === '2026-11-18')?.level).toBe(4);
    expect(cells.filter((cell) => cell.future).map((cell) => cell.date)).toEqual([
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
  });
});

describe('usageSummary', () => {
  it('counts only used days and drops the price when one day has none', () => {
    const summary = usageSummary([
      day('2026-11-04', { coordinator: 200, cost: 1 }),
      day('2026-11-05'),
      day('2026-11-11', { coordinator: 300, cacheRead: 90, input: 10, cost: 1 }),
      day('2026-11-17', { tasks: 200, cost: null }),
    ]);
    expect(summary.usedDays).toBe(3);
    expect(summary.total).toBe(700);
    expect(summary.cacheHit).toBeCloseTo(0.9);
    expect(summary.cost).toBeNull();
  });
});
