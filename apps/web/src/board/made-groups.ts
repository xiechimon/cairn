import type { MadeKind, TodoRecord } from '../fixtures/records.js';

export type MadeGroupKey = Exclude<MadeKind, 'code'> | 'other';

const GROUP_ORDER: readonly MadeGroupKey[] = ['document', 'design', 'page', 'other'];

export const MADE_GROUP_LABEL: Record<MadeGroupKey, string> = {
  document: '文档',
  design: '设计',
  page: '网页',
  other: '其他',
};

export function madeGroupOf(todo: Pick<TodoRecord, 'madeKind' | 'output'>): MadeGroupKey | null {
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
): MadeGroup<T>[] {
  const byKey = new Map<MadeGroupKey, T[]>();
  for (const item of [...items].sort((a, b) => b.phaseAt - a.phaseAt)) {
    const key = madeGroupOf(item);
    if (key !== null) byKey.set(key, [...(byKey.get(key) ?? []), item]);
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
