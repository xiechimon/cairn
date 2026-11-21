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

function newerOf<T extends { id: string; v: number }>(cached: T | undefined, fetched: T): T {
  const newer =
    cached !== undefined && cached.id === fetched.id && cached.v > fetched.v ? cached : fetched;
  const held = pendingPatches.get(newer.id);
  return held === undefined ? newer : Object.assign({}, newer, ...held);
}

export function keepNewerTodo(cached: unknown, fetched: unknown): unknown {
  return replaceEqualDeep(cached, newerOf(cached as TodoRecord | undefined, fetched as TodoRecord));
}

export function keepNewerTodos(cached: unknown, fetched: unknown): unknown {
  const byId = new Map((cached as TodoRecord[] | undefined)?.map((row) => [row.id, row]));
  const merged = (fetched as TodoRecord[]).map((row) => newerOf(byId.get(row.id), row));
  return replaceEqualDeep(cached, merged);
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
  return replaceEqualDeep(cached, { ...next, entries });
}
