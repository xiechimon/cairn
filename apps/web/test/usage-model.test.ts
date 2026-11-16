import { describe, expect, it } from 'vitest';
import { USAGE_WEEKS, usageGrid, usageWindowDays } from '../src/usage/usage-model.js';

describe('usageGrid', () => {
  it('ends on the week holding today, hides the rest of that week and starts on a Monday', () => {
    const grid = usageGrid([], '2026-11-19');
    expect(usageWindowDays('2026-11-19')).toBe((USAGE_WEEKS - 1) * 7 + 4);
    expect(grid.weeks).toHaveLength(USAGE_WEEKS);
    const last = grid.weeks.at(-1) ?? [];
    expect(last.map((cell) => [cell.date, cell.future])).toEqual([
      ['2026-11-16', false],
      ['2026-11-17', false],
      ['2026-11-18', false],
      ['2026-11-19', false],
      ['2026-11-20', true],
      ['2026-11-21', true],
      ['2026-11-22', true],
    ]);
    expect(grid.weeks[0]?.[0]?.date).toBe('2026-05-25');
  });

  it('sums the last 30 days including today and nothing older', () => {
    const grid = usageGrid(
      [
        { date: '2026-10-20', coordinator: 7, tasks: 0 },
        { date: '2026-10-21', coordinator: 10, tasks: 5 },
        { date: '2026-11-19', coordinator: 1, tasks: 2 },
      ],
      '2026-11-19',
    );
    expect(grid.recentTotal).toBe(18);
  });

  it('spreads the used days over four shades and leaves unused days at zero', () => {
    const days = [100, 200, 300, 400, 500, 600, 700, 800].map((tasks, i) => ({
      date: `2026-11-0${i + 1}`,
      coordinator: 0,
      tasks,
    }));
    const levels = usageGrid(days, '2026-11-09')
      .weeks.flat()
      .filter((cell) => cell.date >= '2026-11-01' && cell.date <= '2026-11-09')
      .map((cell) => cell.level);
    expect(levels).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 0]);
  });
});
