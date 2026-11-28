import {
  buildRecordSchema,
  doubaoLoginEventSchema,
  type NotificationRecord,
  notificationRecordSchema,
  type TasksQuery,
  type TodoRecord,
  todoRecordSchema,
} from '@cairn/shared';
import type { QueryClient } from '@tanstack/react-query';
import { invalidateEventQueries, patchQueryData } from './invalidate.js';
import { hasPendingTodoPatch, holdTodoPatch, withPendingTodoPatch } from './todo-freshness.js';

function patchTodo(records: TodoRecord[] | undefined, doc: TodoRecord): TodoRecord[] | undefined {
  if (records === undefined) return records;
  const present = records.find((row) => row.id === doc.id);
  if (present !== undefined && present.v > doc.v) return records;
  if (doc.archivedAt != null)
    return present === undefined ? records : records.filter((row) => row.id !== doc.id);
  return present === undefined
    ? [...records, doc]
    : records.map((row) => (row.id === doc.id ? doc : row));
}

function sectioned(doc: TodoRecord): boolean {
  return doc.section != null && doc.section !== undefined;
}

function patchTaskEntries(data: TasksQuery | undefined, doc: TodoRecord): TasksQuery | undefined {
  if (data === undefined) return data;
  const present = data.entries.find((entry) => entry.kind === 'todo' && entry.id === doc.id);
  if (present?.kind === 'todo' && present.v > doc.v) return data;
  if (!sectioned(doc)) {
    if (present?.kind !== 'todo') return data;
    if (hasPendingTodoPatch(doc.id))
      return {
        entries: data.entries.map((entry) =>
          entry === present ? { ...entry, ...doc, section: present.section } : entry,
        ),
      };
    return { entries: data.entries.filter((entry) => entry !== present) };
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

function applyTodoDoc(qc: QueryClient, teamId: string, doc: TodoRecord): void {
  const visible = withPendingTodoPatch(doc);
  patchQueryData<TodoRecord>(qc, ['todo', doc.id], (current) =>
    current !== undefined && current.v > doc.v ? current : visible,
  );
  patchQueryData<TodoRecord[]>(qc, ['todos', teamId], (records) => patchTodo(records, visible));
  patchQueryData<TasksQuery>(qc, ['tasks', teamId], (data) => patchTaskEntries(data, visible));
}

export function cachedTodo(qc: QueryClient, teamId: string, id: string): TodoRecord | undefined {
  const entry = qc
    .getQueryData<TasksQuery>(['tasks', teamId])
    ?.entries.find((row) => row.kind === 'todo' && row.id === id);
  const rows = [
    entry?.kind === 'todo' ? entry : undefined,
    qc.getQueryData<TodoRecord>(['todo', id]),
    qc.getQueryData<TodoRecord[]>(['todos', teamId])?.find((row) => row.id === id),
    qc.getQueryData<TodoRecord[]>(['todos', teamId, 'archived'])?.find((row) => row.id === id),
  ];
  return rows.reduce<TodoRecord | undefined>(
    (latest, row) => (row?.id === id && (latest === undefined || row.v > latest.v) ? row : latest),
    undefined,
  );
}

export interface OptimisticTodo {
  settle: () => void;
  rollback: () => void;
}

export async function optimisticTodo(
  qc: QueryClient,
  teamId: string,
  id: string,
  patch: Partial<TodoRecord>,
): Promise<OptimisticTodo> {
  const detailKey = ['todo', id];
  const boardKey = ['todos', teamId];
  const tasksKey = ['tasks', teamId];
  await Promise.all(
    [detailKey, boardKey, tasksKey].map((queryKey) => qc.cancelQueries({ queryKey })),
  );
  const cachedBefore = cachedTodo(qc, teamId, id);
  const detailBefore = qc.getQueryData<TodoRecord>(detailKey);
  const boardBefore = qc.getQueryData<TodoRecord[]>(boardKey)?.find((row) => row.id === id);
  const taskBefore = qc
    .getQueryData<TasksQuery>(tasksKey)
    ?.entries.find((entry) => entry.kind === 'todo' && entry.id === id);
  const release = holdTodoPatch(id, patch);
  const updateCaches = (
    update: <T extends TodoRecord>(row: T, before: TodoRecord | undefined) => T,
  ) => {
    qc.setQueryData<TodoRecord>(detailKey, (row) =>
      row?.id === id ? update(row, detailBefore) : row,
    );
    qc.setQueryData<TodoRecord[]>(boardKey, (rows) =>
      rows?.map((row) => (row.id === id ? update(row, boardBefore) : row)),
    );
    qc.setQueryData<TasksQuery>(
      tasksKey,
      (data) =>
        data && {
          ...data,
          entries: data.entries.map((entry) =>
            entry.kind === 'todo' && entry.id === id
              ? update(entry, taskBefore?.kind === 'todo' ? taskBefore : undefined)
              : entry,
          ),
        },
    );
  };
  updateCaches(withPendingTodoPatch);
  return {
    settle: release,
    rollback: () => {
      release();
      updateCaches((row, before) => {
        const previous = before?.id === id ? before : cachedBefore;
        if (previous === undefined) return row;
        const fields = (Object.keys(patch) as (keyof TodoRecord)[]).filter((key) =>
          Object.is(row[key], patch[key]),
        );
        return withPendingTodoPatch({
          ...row,
          ...Object.fromEntries(fields.map((key) => [key, previous[key]])),
        });
      });
    },
  };
}

export function applyTeamStreamEvent(
  qc: QueryClient,
  teamId: string,
  ev: Record<string, unknown>,
): NotificationRecord | undefined {
  switch (ev.type) {
    case 'todo': {
      const { data: doc } = todoRecordSchema.safeParse(ev.doc);
      if (doc === undefined || doc.teamId !== teamId) break;
      void invalidateEventQueries(
        qc,
        { type: 'todo', teamId, doc, previous: cachedTodo(qc, teamId, doc.id) },
        () => applyTodoDoc(qc, teamId, doc),
      );
      break;
    }
    case 'build': {
      const { data: doc } = buildRecordSchema.safeParse(ev.doc);
      if (doc === undefined) break;
      void invalidateEventQueries(qc, {
        type: 'build',
        teamId,
        doc,
        projectId: typeof ev.projectId === 'string' ? ev.projectId : undefined,
        parent: cachedTodo(qc, teamId, doc.todoId),
      });
      break;
    }
    case 'notification': {
      const { data: record } = notificationRecordSchema.safeParse(ev.notification);
      if (record === undefined || record.teamId !== teamId) break;
      void invalidateEventQueries(qc, { type: 'notification', teamId }, () => {
        patchQueryData<{ unreadThreadIds: string[] }>(qc, ['notifications', teamId], (data) => {
          if (data === undefined) return data;
          const ids = data.unreadThreadIds.filter((id) => id !== record.entityId);
          return { unreadThreadIds: record.readAt === null ? [...ids, record.entityId] : ids };
        });
      });
      return record;
    }
    case 'machine_presence':
    case 'computer.state':
    case 'chief.updated':
      void invalidateEventQueries(qc, { type: ev.type, teamId });
      break;
    case 'doubao.login': {
      const { data } = doubaoLoginEventSchema.safeParse(ev);
      if (data !== undefined) {
        void invalidateEventQueries(qc, {
          type: 'doubao.login',
          teamId,
          machineId: data.machineId,
          status: data.status,
        });
      }
      break;
    }
  }
}
