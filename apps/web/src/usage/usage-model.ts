import type { DailyUsageDay } from '@cairn/shared';

export const USAGE_WEEKS = 26;
export const USAGE_SUM_DAYS = 30;

export interface UsageCell {
  date: string;
  weekday: number;
  future: boolean;
  coordinator: number;
  tasks: number;
  total: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface UsageGrid {
  today: string;
  days: number;
  weeks: UsageCell[][];
  monthStarts: (number | null)[];
  recentTotal: number;
}

export function localDay(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms));
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

export function usageWindowDays(today: string): number {
  return (USAGE_WEEKS - 1) * 7 + mondayIndex(today) + 1;
}

function levelsFor(totals: number[]): (total: number) => UsageCell['level'] {
  const used = totals.filter((total) => total > 0).sort((a, b) => a - b);
  const cut = (p: number) => used[Math.floor(p * (used.length - 1))] ?? 0;
  const [low, mid, high] = [cut(0.25), cut(0.5), cut(0.75)];
  return (total) => (total <= 0 ? 0 : total <= low ? 1 : total <= mid ? 2 : total <= high ? 3 : 4);
}

export function usageGrid(
  days: readonly DailyUsageDay[],
  today: string,
  shownWeeks: number = USAGE_WEEKS,
): UsageGrid {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const windowDays = (shownWeeks - 1) * 7 + mondayIndex(today) + 1;
  const start = shiftDay(today, -(windowDays - 1));
  const level = levelsFor(days.map((day) => day.coordinator + day.tasks));
  const recentFrom = shiftDay(today, -(USAGE_SUM_DAYS - 1));
  const weeks: UsageCell[][] = [];
  const monthStarts: (number | null)[] = [];
  let lastMonth = -1;
  for (let w = 0; w < shownWeeks; w++) {
    const week: UsageCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = shiftDay(start, w * 7 + d);
      const day = byDate.get(date);
      const coordinator = day?.coordinator ?? 0;
      const tasks = day?.tasks ?? 0;
      const total = coordinator + tasks;
      week.push({
        date,
        weekday: d,
        future: date > today,
        coordinator,
        tasks,
        total,
        level: level(total),
      });
    }
    const [, month, dayOfMonth] = parts(shiftDay(start, w * 7));
    const shows = month !== lastMonth && (w > 0 || dayOfMonth <= 7);
    monthStarts.push(shows ? month : null);
    if (shows || w > 0) lastMonth = month;
    weeks.push(week);
  }
  const recentTotal = days
    .filter((day) => day.date >= recentFrom && day.date <= today)
    .reduce((sum, day) => sum + day.coordinator + day.tasks, 0);
  return { today, days: windowDays, weeks, monthStarts, recentTotal };
}

export function formatTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${n}`;
}
