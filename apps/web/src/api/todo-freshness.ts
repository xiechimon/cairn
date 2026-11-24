import type { TasksQuery, TodoRecord } from '@cairn/shared';
import { replaceEqualDeep } from '@tanstack/react-query';

const pendingPatches = new Map<string, Partial<TodoRecord>[]>();

export function holdTodoPatch(id: string, patch: Partial<TodoRecord>): () => void {
  const held = [...(pendingPatches.get(id) ?? []), patch];
  pendingPatches.set(id, held);
  return () => {
    const rest = (pendingPatches.get(id) ?? []).filter((entry) => entry !== patch);
    if (rest.length === 0) pendingPatches.delete(id);
    else pendingPatches.set(id, rest);
  };
}

export function hasPendingTodoPatch(id: string): boolean {
  return pendingPatches.has(id);
}

export function withPendingTodoPatch<T extends { id: string }>(todo: T): T {
  const held = pendingPatches.get(todo.id);
  return held === undefined ? todo : Object.assign({}, todo, ...held);
}

function newerOf<T extends { id: string; v: number }>(cached: T | undefined, fetched: T): T {
  return withPendingTodoPatch(
    cached !== undefined && cached.id === fetched.id && cached.v > fetched.v ? cached : fetched,
  );
}

function keepPendingRows<T extends { id: string }>(byId: Map<string, T>, fetched: T[]): T[] {
  for (const row of fetched) byId.delete(row.id);
  return [...byId.values()].filter((row) => hasPendingTodoPatch(row.id));
}

export function keepNewerTodo(cached: unknown, fetched: unknown): unknown {
  return replaceEqualDeep(cached, newerOf(cached as TodoRecord | undefined, fetched as TodoRecord));
}

export function keepNewerTodos(cached: unknown, fetched: unknown): unknown {
  const byId = new Map((cached as TodoRecord[] | undefined)?.map((row) => [row.id, row]));
  const merged = (fetched as TodoRecord[]).map((row) => newerOf(byId.get(row.id), row));
  return replaceEqualDeep(cached, [...merged, ...keepPendingRows(byId, merged)]);
}

export function keepNewerTasks(cached: unknown, fetched: unknown): unknown {
  const previous = (cached as TasksQuery | undefined)?.entries ?? [];
  const byId = new Map(
    previous.flatMap((entry) => (entry.kind === 'todo' ? [[entry.id, entry] as const] : [])),
  );
  const next = fetched as TasksQuery;
  const entries = next.entries.map((entry) =>
    entry.kind === 'todo' ? newerOf(byId.get(entry.id), entry) : entry,
  );
  const pending = keepPendingRows(
    byId,
    entries.filter((entry) => entry.kind === 'todo'),
  );
  return replaceEqualDeep(cached, { ...next, entries: [...entries, ...pending] });
}
