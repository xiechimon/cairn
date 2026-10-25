import type { TodoRecord } from '../fixtures/records.js';

export interface RepoOption {
  id: string;
  name: string;
  count: number;
}

export function parseProjectsParam(raw: string | null): string[] {
  if (raw == null || raw === '') return [];
  return [...new Set(raw.split(','))].filter((id) => id !== '').sort();
}

export function matchesProjectFilter(todo: TodoRecord, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0) return true;
  return selected.has(todo.projectId);
}

export function buildRepoOptions(
  entries: readonly { id: string; name: string }[],
  todos: readonly TodoRecord[],
  otherAxis: (todo: TodoRecord) => boolean,
): RepoOption[] {
  const counts = new Map<string, number>();
  for (const todo of todos) {
    if (!otherAxis(todo)) continue;
    counts.set(todo.projectId, (counts.get(todo.projectId) ?? 0) + 1);
  }
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    count: counts.get(entry.id) ?? 0,
  }));
}
