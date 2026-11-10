import { dayIndex } from './rel-time.js';

export type MadeGroupKey = 'today' | 'yesterday' | 'week' | 'earlier';

export const MADE_GROUP_LABEL: Record<MadeGroupKey, string> = {
  today: '今天',
  yesterday: '昨天',
  week: '本周',
  earlier: '更早',
};

const MONDAY_OFFSET = 3;
const DAYS_PER_WEEK = 7;

export function madeGroupOf(ts: number, now: number): MadeGroupKey {
  const today = dayIndex(now);
  const day = dayIndex(ts);
  if (day >= today) return 'today';
  if (day === today - 1) return 'yesterday';
  const weekStart = today - ((today + MONDAY_OFFSET) % DAYS_PER_WEEK);
  return day >= weekStart ? 'week' : 'earlier';
}

export interface MadeGroup<T> {
  key: MadeGroupKey;
  items: T[];
}

export function groupMade<T extends { phaseAt: number }>(
  items: readonly T[],
  now: number,
): MadeGroup<T>[] {
  const groups: MadeGroup<T>[] = [];
  for (const item of [...items].sort((a, b) => b.phaseAt - a.phaseAt)) {
    const key = madeGroupOf(item.phaseAt, now);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}

export function matchesMadeQuery(
  title: string,
  projectName: string | undefined,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return `${title}\n${projectName ?? ''}`.toLowerCase().includes(needle);
}
