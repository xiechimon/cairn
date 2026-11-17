import type { DailyUsageDay } from '@cairn/shared';

export const USAGE_RANGES = [7, 30, 90] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];
export const USAGE_FETCH_DAYS = 2 * 90;
const MIN_SLOTS = 7;
const TOP_MODELS = 3;
export const OTHER_MODELS = 'other';

export interface UsageSlot {
  date: string;
  day: DailyUsageDay | null;
}

export interface UsageSummary {
  from: string;
  since: string | null;
  slots: UsageSlot[];
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
  change: number | null;
  models: [string, number][];
  projects: [string, number][];
  chartModels: string[];
}

export function localDay(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms));
}

export function shiftDay(date: string, by: number): string {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
}

function ranked(days: readonly DailyUsageDay[], key: 'models' | 'projects'): [string, number][] {
  const sums = new Map<string, number>();
  for (const day of days)
    for (const [id, tokens] of Object.entries(day[key])) sums.set(id, (sums.get(id) ?? 0) + tokens);
  return [...sums].filter(([, tokens]) => tokens > 0).sort((a, b) => b[1] - a[1]);
}

export function usageSummary(
  days: readonly DailyUsageDay[],
  today: string,
  range: UsageRange,
): UsageSummary {
  const from = shiftDay(today, -(range - 1));
  const shown = days.filter((day) => day.date >= from && day.date <= today);
  const first = shown[0]?.date;
  const used = days.some((day) => day.date < from);
  const since = !used && first !== undefined && first > from ? first : null;
  const lastWeek = shiftDay(today, -(MIN_SLOTS - 1));
  const start = (since ?? from) < lastWeek ? (since ?? from) : lastWeek;
  const byDate = new Map(shown.map((day) => [day.date, day]));
  const slots: UsageSlot[] = [];
  for (let date = start; date <= today; date = shiftDay(date, 1))
    slots.push({ date, day: byDate.get(date) ?? null });
  const sum = (pick: (day: DailyUsageDay) => number) =>
    shown.reduce((total, day) => total + pick(day), 0);
  const coordinator = sum((day) => day.coordinator);
  const tasks = sum((day) => day.tasks);
  const input = sum((day) => day.input);
  const cacheRead = sum((day) => day.cacheRead);
  const before = days
    .filter((day) => day.date >= shiftDay(from, -range) && day.date < from)
    .reduce((total, day) => total + day.coordinator + day.tasks, 0);
  const models = ranked(shown, 'models');
  return {
    from,
    since,
    slots,
    usedDays: shown.length,
    total: coordinator + tasks,
    coordinator,
    tasks,
    input,
    output: sum((day) => day.output),
    cacheRead,
    cacheWrite: sum((day) => day.cacheWrite),
    cacheHit: input + cacheRead === 0 ? null : cacheRead / (input + cacheRead),
    tasksRun: new Set(shown.flatMap((day) => day.todos)).size,
    cost:
      shown.length > 0 && shown.every((day) => day.cost !== null)
        ? sum((day) => day.cost ?? 0)
        : null,
    change: before > 0 ? (coordinator + tasks) / before - 1 : null,
    models,
    projects: ranked(shown, 'projects'),
    chartModels:
      models.length > TOP_MODELS + 1
        ? [...models.slice(0, TOP_MODELS).map(([key]) => key), OTHER_MODELS]
        : models.map(([key]) => key),
  };
}

export function modelSeries(day: DailyUsageDay, chartModels: readonly string[]): number[] {
  const named = chartModels.filter((key) => key !== OTHER_MODELS);
  return chartModels.map((key) =>
    key === OTHER_MODELS
      ? Object.entries(day.models)
          .filter(([model]) => !named.includes(model))
          .reduce((total, [, tokens]) => total + tokens, 0)
      : (day.models[key] ?? 0),
  );
}

export function axisMax(value: number): number {
  if (value <= 0) return 1e6;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * power >= value) ?? 10;
  return step * power;
}

export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${n}`;
}

export function formatAxis(n: number): string {
  if (n >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  return `${Math.round(n / 1e3)}K`;
}
