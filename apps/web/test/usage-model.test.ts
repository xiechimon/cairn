import type { DailyUsageDay } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { modelSeries, OTHER_MODELS, usageSummary } from '../src/usage/usage-model.js';

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

describe('usageSummary', () => {
  it('starts a new user at their first day, padded to a week, with no comparison', () => {
    const summary = usageSummary(
      [day('2026-11-16', { coordinator: 100 }), day('2026-11-17', { tasks: 50 })],
      '2026-11-17',
      30,
    );
    expect(summary.since).toBe('2026-11-16');
    expect(summary.slots.map((slot) => slot.date)).toEqual([
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
    ]);
    expect(summary.total).toBe(150);
    expect(summary.change).toBeNull();
  });

  it('shows the whole range and compares with the range before it once older usage exists', () => {
    const summary = usageSummary(
      [
        day('2026-11-01', { tasks: 999 }),
        day('2026-11-04', { coordinator: 200 }),
        day('2026-11-11', { coordinator: 300, cacheRead: 90, input: 10, cost: 1 }),
        day('2026-11-17', { tasks: 200, cost: null }),
      ],
      '2026-11-17',
      7,
    );
    expect(summary.since).toBeNull();
    expect(summary.slots[0]?.date).toBe('2026-11-11');
    expect(summary.slots).toHaveLength(7);
    expect(summary.total).toBe(500);
    expect(summary.change).toBeCloseTo(1.5);
    expect(summary.cacheHit).toBeCloseTo(0.9);
    expect(summary.cost).toBeNull();
  });

  it('folds models past the top three into one series that still adds up to the day', () => {
    const models = { a: 50, b: 40, c: 30, d: 20, e: 10 };
    const summary = usageSummary(
      [day('2026-11-17', { coordinator: 150, models })],
      '2026-11-17',
      7,
    );
    expect(summary.chartModels).toEqual(['a', 'b', 'c', OTHER_MODELS]);
    const first = summary.slots.at(-1)?.day;
    expect(first && modelSeries(first, summary.chartModels)).toEqual([50, 40, 30, 30]);
  });
});
