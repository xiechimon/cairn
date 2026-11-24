import { DAILY_USAGE_MAX_DAYS, type DailyUsageDay, localDay } from '@cairn/shared';
import { cacheHitShare } from '../api/mappers.js';

export { localDay };

export const USAGE_WEEKS = 53;
export const USAGE_NARROW_WEEKS = 16;
export const USAGE_FETCH_DAYS = DAILY_USAGE_MAX_DAYS;

export interface UsageCell {
  date: string;
  weekday: number;
  future: boolean;
  day: DailyUsageDay | null;
  total: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface UsageGrid {
  from: string;
  days: number;
  weeks: UsageCell[][];
  monthStarts: (number | null)[];
}

export interface UsageSummary {
  usedDays: number;
  total: number;
  coordinator: number;
  tasks: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheHit: number | null;
  tasksRun: number;
  cost: number | null;
  models: [string, number][];
  projects: [string, number][];
}

function parts(date: string): [number, number, number] {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number);
  return [y, m, d];
}

export function shiftDay(date: string, by: number): string {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
}

export function mondayIndex(date: string): number {
  const [y, m, d] = parts(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function levelsFor(totals: number[]): (total: number) => UsageCell['level'] {
  const used = totals.filter((total) => total > 0).sort((a, b) => a - b);
  const cut = (p: number) => used[Math.floor(p * (used.length - 1))] ?? 0;
  const [low, mid, high] = [cut(0.25), cut(0.5), cut(0.75)];
  return (total) => (total <= 0 ? 0 : total <= low ? 1 : total <= mid ? 2 : total <= high ? 3 : 4);
}

const dayTotal = (day: DailyUsageDay) => day.coordinator + day.tasks;

export function usageGrid(
  days: readonly DailyUsageDay[],
  today: string,
  shownWeeks: number = USAGE_WEEKS,
): UsageGrid {
  const windowDays = (shownWeeks - 1) * 7 + mondayIndex(today) + 1;
  const from = shiftDay(today, -(windowDays - 1));
  const shown = days.filter((day) => day.date >= from && day.date <= today);
  const byDate = new Map(shown.map((day) => [day.date, day]));
  const level = levelsFor(shown.map(dayTotal));
  const weeks: UsageCell[][] = [];
  const monthStarts: (number | null)[] = [];
  let lastMonth = -1;
  for (let w = 0; w < shownWeeks; w++) {
    const week: UsageCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = shiftDay(from, w * 7 + d);
      const day = byDate.get(date) ?? null;
      const total = day === null ? 0 : dayTotal(day);
      week.push({ date, weekday: d, future: date > today, day, total, level: level(total) });
    }
    const [, month, dayOfMonth] = parts(shiftDay(from, w * 7));
    const shows = month !== lastMonth && (w > 0 || dayOfMonth <= 7);
    monthStarts.push(shows ? month : null);
    lastMonth = month;
    weeks.push(week);
  }
  return { from, days: windowDays, weeks, monthStarts };
}

function ranked(days: readonly DailyUsageDay[], key: 'models' | 'projects'): [string, number][] {
  const sums = new Map<string, number>();
  for (const day of days)
    for (const [id, tokens] of Object.entries(day[key])) sums.set(id, (sums.get(id) ?? 0) + tokens);
  return [...sums].filter(([, tokens]) => tokens > 0).sort((a, b) => b[1] - a[1]);
}

export function usageSummary(days: readonly DailyUsageDay[]): UsageSummary {
  const sum = (pick: (day: DailyUsageDay) => number) =>
    days.reduce((total, day) => total + pick(day), 0);
  const coordinator = sum((day) => day.coordinator);
  const tasks = sum((day) => day.tasks);
  const input = sum((day) => day.input);
  const cacheRead = sum((day) => day.cacheRead);
  const cacheWrite = sum((day) => day.cacheWrite);
  return {
    usedDays: days.filter((day) => dayTotal(day) > 0).length,
    total: coordinator + tasks,
    coordinator,
    tasks,
    input,
    output: sum((day) => day.output),
    cacheRead,
    cacheWrite,
    cacheHit: cacheHitShare({ input, cacheRead, cacheWrite }),
    tasksRun: new Set(days.flatMap((day) => day.todos)).size,
    cost:
      days.length > 0 && days.every((day) => day.cost !== null)
        ? sum((day) => day.cost ?? 0)
        : null,
    models: ranked(days, 'models'),
    projects: ranked(days, 'projects'),
  };
}

export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${n}`;
}
