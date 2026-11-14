import {
  tasksQuerySchema,
  todoRecordSchema,
  type TasksQuery,
  type TodoRecord as WireTodo,
} from '@cairn/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { tasksQuery, todoQuery, todosQuery } from '../src/api/hooks.js';
import {
  applyTeamStreamEvent,
  listRefetchDue,
  refetchTeamLists,
} from '../src/api/team-stream-cache.js';
function row(seq: number, phase: WireTodo['phase'], extra: Partial<WireTodo> = {}): WireTodo {
  return todoRecordSchema.parse({
    id: `todo-${seq}`,
    teamId: TEAM,
    projectId: 'project-1',
    title: `task ${seq}`,
    spec: `task ${seq}`,
    phase,
    phaseAt: 1,
    seqNum: seq,
    orderIndex: 0,
    tagIds: [],
    latestBuildId: null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 2,
    createdBy: 'user-1',
    ownerId: null,
    sourceBuildId: null,
    sourceKind: null,
    sourceRef: null,
    output: 'code',
    ...extra,
  });
}

function taskRow(row: WireTodo): TasksQuery['entries'][number] {
  return { kind: 'todo', ...row, section: row.section ?? null };
}

const TEAM = 'team-1';

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function event(doc: WireTodo): Record<string, unknown> {
  return { type: 'todo', seq: 1, v: doc.v, doc };
}

describe('team stream patches the board lists instead of refetching them', () => {
  it('replaces the matching todo and task row, and leaves every other row untouched', () => {
    const qc = client();
    const kept = row(1, 'todo');
    const target = row(2, 'building');
    qc.setQueryData(['todos', TEAM], [kept, target]);
    qc.setQueryData(['tasks', TEAM], tasksQuerySchema.parse({ entries: [taskRow(kept), taskRow(target)] }));
    const next = {
      ...target,
      phase: 'confirm' as const,
      v: target.v + 1,
      section: 'needs_input' as const,
    };

    expect(applyTeamStreamEvent(qc, TEAM, event(next))).toBe(true);

    expect(qc.getQueryData<WireTodo[]>(['todos', TEAM])).toEqual([kept, next]);
    expect(qc.getQueryData<WireTodo>(['todo', target.id])).toEqual(next);
    expect(qc.getQueryData<TasksQuery>(['tasks', TEAM])?.entries[1]).toEqual(taskRow(next));
    expect(qc.getQueryData<TasksQuery>(['tasks', TEAM])?.entries[0]).toEqual(taskRow(kept));
  });

  it('appends a todo the lists have not seen, and drops one that left the tasks sections', () => {
    const qc = client();
    const fresh = row(3, 'todo', { section: 'up_next' });
    qc.setQueryData<WireTodo[]>(['todos', TEAM], []);
    qc.setQueryData(['tasks', TEAM], tasksQuerySchema.parse({ entries: [] }));

    applyTeamStreamEvent(qc, TEAM, event(fresh));
    expect(qc.getQueryData<WireTodo[]>(['todos', TEAM])).toEqual([fresh]);
    expect(qc.getQueryData<TasksQuery>(['tasks', TEAM])?.entries).toEqual([taskRow(fresh)]);

    applyTeamStreamEvent(qc, TEAM, event({ ...fresh, section: null }));
    expect(qc.getQueryData<TasksQuery>(['tasks', TEAM])?.entries).toEqual([]);
    expect(qc.getQueryData<WireTodo[]>(['todos', TEAM])).toEqual([{ ...fresh, section: null }]);
  });

  it('removes an archived todo from the board list and keeps the tasks questions', () => {
    const qc = client();
    const target = row(4, 'done');
    const question: TasksQuery['entries'][number] = {
      kind: 'question',
      requestId: 'req-1',
      threadId: 'thread-1',
      projectId: null,
      title: 'pick one',
      section: 'needs_input',
      createdAt: 1,
      content: {
        kind: 'ask_user_question',
        requestId: 'req-1',
        status: 'pending',
        questions: [{ header: 'h', question: 'q', options: [{ label: 'a' }] }],
        answers: null,
      },
    };
    qc.setQueryData(['todos', TEAM], [target]);
    qc.setQueryData(['tasks', TEAM], tasksQuerySchema.parse({ entries: [question, taskRow(target)] }));

    applyTeamStreamEvent(qc, TEAM, event({ ...target, archivedAt: 5 }));

    expect(qc.getQueryData(['todos', TEAM])).toEqual([]);
    expect(qc.getQueryData<TasksQuery>(['tasks', TEAM])?.entries).toEqual([question]);
  });

  it('does not invent a list that was never fetched', () => {
    const qc = client();
    const unseen = row(5, 'todo');
    applyTeamStreamEvent(qc, TEAM, event(unseen));
    expect(qc.getQueryData(['todos', TEAM])).toBeUndefined();
    expect(qc.getQueryData(['tasks', TEAM])).toBeUndefined();
    expect(qc.getQueryData(['todo', unseen.id])).toEqual(unseen);
  });

  it('a document the schema rejects falls back to the refetch path', () => {
    const qc = client();
    expect(applyTeamStreamEvent(qc, TEAM, { type: 'todo', doc: { id: 'nope' } })).toBe(false);
    expect(qc.getQueryData(['todo', 'nope'])).toBeUndefined();
  });

  it('a build event writes the build cache and leaves the lists for the following todo event', () => {
    const qc = client();
    const build = {
      id: 'build-1',
      todoId: 'todo-1',
      withPlan: false,
      prevPhase: null,
      triggerSource: 'user',
      planDocId: null,
      errorMessage: null,
      prUrl: null,
      prNumber: null,
      diffHash: null,
      createdAt: 1,
    };
    expect(applyTeamStreamEvent(qc, TEAM, { type: 'build', doc: build })).toBe(false);
    expect(qc.getQueryData(['build', 'build-1'])).toEqual(build);
  });

  it('a notification flips the unread badge without touching the lists', () => {
    const qc = client();
    qc.setQueryData(['notifications', TEAM], { unreadThreadIds: ['old'] });
    const notification = {
      teamId: TEAM,
      userId: 'user-1',
      type: 'plan_ready',
      entityId: 'todo-9',
      entityRef: { title: 'a task', projectId: null, seqNum: 9 },
      agent: { name: 'agent', avatarUrl: null },
      snippet: null,
      id: 'n-1',
      readAt: null,
      createdAt: 1,
      channels: ['in_app'],
    };
    expect(applyTeamStreamEvent(qc, TEAM, { type: 'notification', notification })).toBe(false);
    expect(qc.getQueryData(['notifications', TEAM])).toEqual({
      unreadThreadIds: ['old', 'todo-9'],
    });
  });

  it('refetches a list at most once a second, and never one that is not loaded', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const qc = client();
    qc.setQueryData(['todos', TEAM], [row(1, 'todo')]);
    const refetch = vi.spyOn(qc, 'refetchQueries').mockResolvedValue();

    expect(listRefetchDue(qc, TEAM)).toBe(true);
    refetchTeamLists(qc, TEAM);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith({ queryKey: ['todos', TEAM], type: 'active' });

    vi.setSystemTime(14_000);
    expect(listRefetchDue(qc, TEAM)).toBe(false);
    vi.setSystemTime(15_000);
    expect(listRefetchDue(qc, TEAM)).toBe(true);
    vi.useRealTimers();
  });
});

describe('a fetch that started before a pushed todo cannot roll it back', () => {
  function held<T>() {
    let release: (value: T) => void = () => {};
    const pending = new Promise<T>((resolve) => {
      release = resolve;
    });
    return { pending, release };
  }

  it('keeps the pushed building phase when an older single-todo fetch lands after it', async () => {
    const qc = client();
    const fetch = held<WireTodo>();
    const fetching = qc.fetchQuery({ ...todoQuery('todo-1'), queryFn: () => fetch.pending });
    applyTeamStreamEvent(qc, TEAM, event(row(1, 'building', { v: 6 })));
    fetch.release(row(1, 'queued', { v: 5 }));
    await fetching;
    expect(qc.getQueryData<WireTodo>(['todo', 'todo-1'])?.phase).toBe('building');
  });

  it('keeps the pushed row in the todo and task lists when an older list fetch lands after it', async () => {
    const qc = client();
    qc.setQueryData(['todos', TEAM], [row(1, 'queued', { v: 5 }), row(2, 'todo')]);
    qc.setQueryData(['tasks', TEAM], {
      entries: [taskRow(row(1, 'queued', { v: 5, section: 'up_next' }))],
    });
    const todos = held<WireTodo[]>();
    const tasks = held<TasksQuery>();
    const fetchingTodos = qc.fetchQuery({ ...todosQuery(TEAM), queryFn: () => todos.pending });
    const fetchingTasks = qc.fetchQuery({ ...tasksQuery(TEAM), queryFn: () => tasks.pending });
    applyTeamStreamEvent(qc, TEAM, event(row(1, 'building', { v: 6, section: 'up_next' })));
    todos.release([row(1, 'queued', { v: 5 }), row(2, 'todo', { v: 3 })]);
    tasks.release({ entries: [taskRow(row(1, 'queued', { v: 5, section: 'up_next' }))] });
    await Promise.all([fetchingTodos, fetchingTasks]);
    const list = qc.getQueryData<WireTodo[]>(['todos', TEAM]) ?? [];
    expect(list.find((todo) => todo.id === 'todo-1')?.phase).toBe('building');
    expect(list.find((todo) => todo.id === 'todo-2')?.v).toBe(3);
    const entry = qc.getQueryData<TasksQuery>(['tasks', TEAM])?.entries[0];
    expect(entry?.kind === 'todo' ? entry.phase : null).toBe('building');
  });

  it('takes a newer fetch over an older cached row', async () => {
    const qc = client();
    applyTeamStreamEvent(qc, TEAM, event(row(1, 'queued', { v: 5 })));
    await qc.fetchQuery({ ...todoQuery('todo-1'), queryFn: async () => row(1, 'building', { v: 6 }) });
    expect(qc.getQueryData<WireTodo>(['todo', 'todo-1'])?.phase).toBe('building');
  });
});
