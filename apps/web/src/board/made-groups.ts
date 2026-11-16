import type { MadeKind, TodoRecord } from '../fixtures/records.js';
import { dayIndex } from './rel-time.js';

type MadeKindGroup = Exclude<MadeKind, 'code'> | 'other';

export type MadeGroupKey = MadeKindGroup | 'earlier';

const GROUP_ORDER: readonly MadeGroupKey[] = [
  'document',
  'design',
  'page',
  'slides',
  'other',
  'earlier',
];

export const MADE_EARLIER_DAYS = 7;

export const MADE_GROUP_LABEL: Record<MadeGroupKey, string> = {
  document: '文档',
  design: '设计',
  page: '网页',
  slides: 'PPT',
  other: '其他',
  earlier: '更早',
};

export function madeGroupOf(todo: Pick<TodoRecord, 'madeKind' | 'output'>): MadeKindGroup | null {
  const kind = todo.madeKind ?? (todo.output === 'info' ? 'document' : todo.output);
  if (kind === 'code') return null;
  return kind ?? 'other';
}

export interface MadeGroup<T> {
  key: MadeGroupKey;
  items: T[];
}

export function groupMade<T extends Pick<TodoRecord, 'madeKind' | 'output' | 'phaseAt'>>(
  items: readonly T[],
  now: number,
): MadeGroup<T>[] {
  const byKey = new Map<MadeGroupKey, T[]>();
  for (const item of [...items].sort((a, b) => b.phaseAt - a.phaseAt)) {
    const kind = madeGroupOf(item);
    if (kind === null) continue;
    const key = dayIndex(now) - dayIndex(item.phaseAt) >= MADE_EARLIER_DAYS ? 'earlier' : kind;
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  return GROUP_ORDER.flatMap((key) => {
    const group = byKey.get(key);
    return group === undefined ? [] : [{ key, items: group }];
  });
}

export function matchesMadeQuery(
  title: string,
  projectName: string | undefined,
  query: string,
  kindLabel = '',
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return `${title}\n${projectName ?? ''}\n${kindLabel}`.toLowerCase().includes(needle);
}
