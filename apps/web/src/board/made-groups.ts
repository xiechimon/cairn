import type { MadeKind, TodoRecord } from '../fixtures/records.js';

export type MadeGroupKey = MadeKind | 'other';

const GROUP_ORDER: readonly MadeGroupKey[] = ['document', 'design', 'page', 'code', 'other'];

export const MADE_GROUP_LABEL: Record<MadeGroupKey, string> = {
  document: '文档',
  design: '设计',
  page: '网页',
  code: '代码改动',
  other: '其他',
};

export function madeKindOf(todo: Pick<TodoRecord, 'madeKind' | 'output'>): MadeGroupKey {
  if (todo.madeKind !== undefined) return todo.madeKind;
  if (todo.output === 'code') return 'code';
  if (todo.output === 'info') return 'document';
  return 'other';
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
    const key = madeKindOf(item);
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
