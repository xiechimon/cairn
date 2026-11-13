import type { TasksQuery, TodoRecord } from '@cairn/shared';
import { buildRecordSchema, notificationRecordSchema, todoRecordSchema } from '@cairn/shared';
import type { QueryClient } from '@tanstack/react-query';

export const TEAM_LIST_KEYS = ['todos', 'tasks'] as const;

const LIST_REFETCH_MS = 5_000;
const lastListRefetchAt = new WeakMap<QueryClient, number>();

function patchTodo(records: TodoRecord[] | undefined, doc: TodoRecord): TodoRecord[] | undefined {
  if (records === undefined) return records;
  if (doc.archivedAt != null) return records.filter((row) => row.id !== doc.id);
  return records.some((row) => row.id === doc.id)
    ? records.map((row) => (row.id === doc.id ? doc : row))
    : [...records, doc];
}

function sectioned(doc: TodoRecord): boolean {
  return doc.section != null && doc.section !== undefined;
}

function patchTaskEntries(data: TasksQuery | undefined, doc: TodoRecord): TasksQuery | undefined {
  if (data === undefined) return data;
  const present = data.entries.some((entry) => entry.kind === 'todo' && entry.id === doc.id);
  if (!sectioned(doc)) {
    return present
      ? { entries: data.entries.filter((entry) => entry.kind !== 'todo' || entry.id !== doc.id) }
      : data;
  }
  const next: TasksQuery['entries'][number] = {
    kind: 'todo',
    ...doc,
    section: doc.section ?? null,
  };
  return {
    entries: present
      ? data.entries.map((entry) => (entry.kind === 'todo' && entry.id === doc.id ? next : entry))
      : [...data.entries, next],
  };
}

export function applyTeamStreamEvent(
  qc: QueryClient,
  teamId: string,
  ev: Record<string, unknown>,
): boolean {
  if (ev.type === 'todo') {
    const parsed = todoRecordSchema.safeParse(ev.doc);
    if (!parsed.success) return false;
    const doc = parsed.data;
    qc.setQueryData<TodoRecord>(['todo', doc.id], doc);
    qc.setQueryData<TodoRecord[]>(['todos', teamId], (records) => patchTodo(records, doc));
    qc.setQueryData<TasksQuery>(['tasks', teamId], (data) => patchTaskEntries(data, doc));
    return true;
  }
  if (ev.type === 'build') {
    const parsed = buildRecordSchema.safeParse(ev.doc);
    if (!parsed.success) return false;
    qc.setQueryData(['build', parsed.data.id], parsed.data);
    return false;
  }
  if (ev.type === 'notification') {
    const parsed = notificationRecordSchema.safeParse(ev.notification);
    if (!parsed.success) return false;
    const record = parsed.data;
    qc.setQueryData<{ unreadThreadIds: string[] }>(['notifications', teamId], (data) => {
      if (data === undefined) return data;
      const ids = data.unreadThreadIds.filter((id) => id !== record.entityId);
      return { unreadThreadIds: record.readAt === null ? [...ids, record.entityId] : ids };
    });
    return false;
  }
  return false;
}

export function listRefetchDue(qc: QueryClient, teamId: string, now = Date.now()): boolean {
  const loaded = TEAM_LIST_KEYS.some((head) => qc.getQueryData([head, teamId]) !== undefined);
  if (!loaded) return false;
  const last = lastListRefetchAt.get(qc);
  return last === undefined || now - last >= LIST_REFETCH_MS;
}

export function notePatchedEvent(qc: QueryClient, teamId: string, now = Date.now()): boolean {
  if (!listRefetchDue(qc, teamId, now)) return false;
  refetchTeamLists(qc, teamId, now);
  return true;
}

export function refetchTeamLists(qc: QueryClient, teamId: string, now = Date.now()): void {
  lastListRefetchAt.set(qc, now);
  for (const head of TEAM_LIST_KEYS) {
    if (qc.getQueryData([head, teamId]) === undefined) continue;
    void qc.refetchQueries({ queryKey: [head, teamId], type: 'active' });
  }
}
