import {
  type BuildRecord,
  tasksQuerySchema,
  todoRecordSchema,
  type TasksQuery,
  type TodoRecord as WireTodo,
} from '@cairn/shared';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { type ApiMutations, tasksQuery, todoQuery, todosQuery, useApiMutations } from '../src/api/hooks.js';
import { recoverQueries } from '../src/api/invalidate.js';
import { startTeamStream } from '../src/api/sse.js';
import { applyTeamStreamEvent } from '../src/api/team-stream-cache.js';
import { FakeEventSource } from './tab-stream-harness.js';

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
const build: BuildRecord = {
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

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function event(doc: WireTodo): Record<string, unknown> {
  return { type: 'todo', v: doc.v, doc };
}

describe('team stream cache patches', () => {
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

    applyTeamStreamEvent(qc, TEAM, event(next));

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

    const unsectioned = { ...fresh, section: null, v: fresh.v + 1 };
    applyTeamStreamEvent(qc, TEAM, event(unsectioned));
    expect(qc.getQueryData<TasksQuery>(['tasks', TEAM])?.entries).toEqual([]);
    expect(qc.getQueryData<WireTodo[]>(['todos', TEAM])).toEqual([unsectioned]);
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

    applyTeamStreamEvent(qc, TEAM, event({ ...target, archivedAt: 5, v: target.v + 1 }));

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

  it('does not replace a strictly newer todo in any cache', () => {
    const qc = client();
    const cached = row(1, 'confirm', { section: 'needs_input' });
    qc.setQueryData(['todo', cached.id], cached);
    qc.setQueryData(['todos', TEAM], [cached]);
    qc.setQueryData(['tasks', TEAM], { entries: [taskRow(cached)] });

    applyTeamStreamEvent(qc, TEAM, event(row(1, 'building', { v: 1, section: 'up_next' })));

    expect(qc.getQueryData(['todo', cached.id])).toEqual(cached);
    expect(qc.getQueryData(['todos', TEAM])).toEqual([cached]);
    expect(qc.getQueryData(['tasks', TEAM])).toEqual({ entries: [taskRow(cached)] });
  });

  it('a document the schema rejects does not patch or refresh the cache', () => {
    const qc = client();
    const key = ['todos', TEAM];
    qc.setQueryData(key, []);
    applyTeamStreamEvent(qc, TEAM, { type: 'todo', doc: { id: 'nope' } });
    expect(qc.getQueryData(['todo', 'nope'])).toBeUndefined();
    expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it('a build event marks inactive projections stale without seeding or patching them', () => {
    const qc = client();
    const key = ['todo', build.todoId];
    const parent = row(1, 'building');
    qc.setQueryData(key, parent);
    applyTeamStreamEvent(qc, TEAM, { type: 'build', doc: build });
    expect(qc.getQueryData(['build', build.id])).toBeUndefined();
    expect(qc.getQueryData(key)).toEqual(parent);
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
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
    applyTeamStreamEvent(qc, TEAM, { type: 'notification', notification });
    expect(qc.getQueryData(['notifications', TEAM])).toEqual({
      unreadThreadIds: ['old', 'todo-9'],
    });
  });

});

describe('pending todo mutations', () => {
  function mutationsFor(qc: QueryClient): ApiMutations {
    let mutations: ApiMutations | undefined;
    function Harness() {
      mutations = useApiMutations(TEAM);
      return null;
    }
    renderToString(createElement(QueryClientProvider, { client: qc }, createElement(Harness)));
    if (mutations === undefined) throw new Error('Mutation harness did not render');
    return mutations;
  }

  it('moves the sectioned task even when another projection has unusable data for the same key', async () => {
    const qc = client();
    const task = row(1, 'review', { section: 'ready_for_review' });
    const key = tasksQuery(TEAM).queryKey;
    qc.setQueryData(key, { entries: [taskRow(task)] });
    qc.setQueryData(['todo', task.id], []);
    qc.setQueryData(['todos', TEAM], [row(1, 'building')]);
    const phases: unknown[] = [];
    const post = vi.spyOn(api, 'post').mockImplementation(async () => {
      phases.push(qc.getQueryData<TasksQuery>(key)?.entries[0]);
      return { state: 'done', todo: { ...task, phase: 'done' } };
    });
    try {
      await mutationsFor(qc).stopAndDoneTodo.mutateAsync(task.id);
      expect(phases).toEqual([expect.objectContaining({ section: 'resolved', phase: 'done' })]);
    } finally {
      post.mockRestore();
      qc.clear();
    }
  });

  it.each(['success', 'failure'] as const)('keeps the task moved through live refresh until the mutation reports %s', async (outcome) => {
    const qc = client();
    const task = row(1, 'review', { section: 'ready_for_review' });
    const neighbor = row(2, 'todo', { section: 'up_next' });
    const updated = { ...neighbor, title: 'Updated elsewhere', v: 3 };
    const done = { ...task, phase: 'done', section: 'resolved', v: 3 } as const;
    const options = tasksQuery(TEAM);
    let serverTasks = [taskRow(task), taskRow(neighbor)];
    let finishRead!: (data: TasksQuery) => void;
    let settlementRead: Promise<TasksQuery> | undefined;
    const reads = vi.fn(async () => settlementRead ?? { entries: serverTasks });
    const observer = new QueryObserver(qc, { ...options, queryFn: reads, staleTime: Infinity });
    qc.setQueryData(options.queryKey, { entries: serverTasks });
    const stop = observer.subscribe(() => {});
    let resolvePost!: (value: unknown) => void;
    let rejectPost!: (reason: Error) => void;
    const post = vi.spyOn(api, 'post').mockReturnValue(new Promise((resolve, reject) => {
      resolvePost = resolve;
      rejectPost = reject;
    }));
    const entries = () => observer.getCurrentResult().data?.entries;
    const current = () => entries()?.find((entry) => entry.kind === 'todo' && entry.id === task.id);
    const settlement = Promise.allSettled([mutationsFor(qc).stopAndDoneTodo.mutateAsync(task.id)]);
    try {
      await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
      expect(current()).toMatchObject({ section: 'resolved', phase: 'done' });

      serverTasks = [taskRow(updated)];
      applyTeamStreamEvent(qc, TEAM, event({ ...task, section: null }));
      applyTeamStreamEvent(qc, TEAM, event(updated));
      await vi.waitFor(() => expect(observer.getCurrentResult().isFetching).toBe(false));
      expect(reads).toHaveBeenCalled();
      expect(entries()).toContainEqual(taskRow(updated));
      expect(current()).toMatchObject({ section: 'resolved', phase: 'done' });

      const final = outcome === 'success' ? done : task;
      serverTasks = [taskRow(final), taskRow(updated)];
      const readsBeforeSettlement = reads.mock.calls.length;
      settlementRead = new Promise<TasksQuery>((resolve) => { finishRead = resolve; });
      if (outcome === 'success') resolvePost({ state: 'done', todo: done });
      else rejectPost(new Error('Completion not accepted'));
      const [result] = await settlement;
      expect(result?.status).toBe(outcome === 'success' ? 'fulfilled' : 'rejected');
      await vi.waitFor(() => expect(reads.mock.calls.length).toBeGreaterThan(readsBeforeSettlement));
      expect(entries()).toContainEqual(taskRow(updated));
      expect(current()).toMatchObject({ phase: final.phase, section: final.section });
      finishRead({ entries: serverTasks });
      await vi.waitFor(() => expect(current()).toEqual(taskRow(final)));
    } finally {
      rejectPost(new Error('Settlement cleanup'));
      finishRead?.({ entries: serverTasks });
      await settlement;
      stop();
      post.mockRestore();
      qc.clear();
    }
  });

  it('reads a renamed task on reconnect without undoing a pending unarchive', async () => {
    const qc = client();
    const task = row(1, 'done', { archivedAt: 7 });
    const renamed = { ...task, title: 'Renamed elsewhere', v: 3 };
    const options = todoQuery(task.id);
    qc.setQueryData(options.queryKey, task);
    const observer = new QueryObserver(qc, { ...options, queryFn: async () => renamed, staleTime: Infinity });
    const stop = observer.subscribe(() => {});
    let rejectPost!: (reason: Error) => void;
    const post = vi.spyOn(api, 'post').mockReturnValue(new Promise((_resolve, reject) => { rejectPost = reject; }));
    const mutation = mutationsFor(qc).setTodoArchived.mutateAsync({ id: task.id, archived: false });
    const settlement = Promise.allSettled([mutation]);
    try {
      await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
      expect(observer.getCurrentResult().data?.archivedAt).toBeNull();
      await recoverQueries(qc, new AbortController().signal);
      expect(observer.getCurrentResult().data).toEqual({ ...renamed, archivedAt: null });
      rejectPost(new Error('Unarchive not accepted'));
      expect((await settlement)[0]?.status).toBe('rejected');
      expect(observer.getCurrentResult().data).toEqual(renamed);
    } finally {
      rejectPost(new Error('Settlement cleanup'));
      await settlement;
      stop();
      post.mockRestore();
      qc.clear();
    }
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

  it('aborts the real todo GET and replaces an unobserved first read', async () => {
    const qc = client();
    const earlier = held<Response>();
    const later = held<Response>();
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockReturnValueOnce(earlier.pending)
      .mockReturnValue(later.pending);
    const options = todoQuery('todo-1');
    const pushed = row(1, 'building', { v: 6 });
    vi.stubGlobal('fetch', fetch);
    try {
      const fetching = qc.fetchQuery(options);
      applyTeamStreamEvent(qc, TEAM, event(pushed));
      earlier.release(Response.json(row(1, 'queued', { v: 5 })));
      await Promise.allSettled([fetching]);
      expect(fetch.mock.calls.map(([url, init]) => [url, init.signal?.aborted])).toEqual([
        ['/api/todos/todo-1', true],
        ['/api/todos/todo-1', false],
      ]);
      expect(qc.getQueryData(options.queryKey)).toEqual(pushed);
      const current = { ...pushed, title: 'Current server title' };
      later.release(Response.json(current));
      await vi.waitFor(() => expect(qc.getQueryData(options.queryKey)).toEqual(current));
    } finally {
      qc.clear();
      vi.unstubAllGlobals();
    }
  });

  it('does not mark partial list patches fresh', async () => {
    const qc = client();
    const key = ['todos', TEAM];
    qc.setQueryData(key, [row(1, 'queued')], { updatedAt: 50 });
    await qc.invalidateQueries({ queryKey: key, refetchType: 'none' });
    applyTeamStreamEvent(qc, TEAM, event(row(1, 'building')));
    expect(qc.getQueryState(key)).toMatchObject({ isInvalidated: true, dataUpdatedAt: 50 });
  });

  it('keeps pushed rows in inactive lists while their interrupted reads are replaced', async () => {
    const qc = client();
    const old = row(1, 'queued', { v: 5, section: 'up_next' });
    const next = row(1, 'building', { v: 6, section: 'up_next' });
    const kept = row(2, 'todo');
    const todoList = ['todos', TEAM];
    const taskList = ['tasks', TEAM];
    qc.setQueryData(todoList, [old, kept]);
    qc.setQueryData(taskList, { entries: [taskRow(old)] });
    const todos = held<WireTodo[]>();
    const tasks = held<TasksQuery>();
    const freshTodos = held<WireTodo[]>();
    const freshTasks = held<TasksQuery>();
    const readTodos = vi.fn().mockReturnValueOnce(todos.pending).mockReturnValue(freshTodos.pending);
    const readTasks = vi.fn().mockReturnValueOnce(tasks.pending).mockReturnValue(freshTasks.pending);
    const fetchingTodos = qc.fetchQuery({ ...todosQuery(TEAM), queryFn: readTodos });
    const fetchingTasks = qc.fetchQuery({ ...tasksQuery(TEAM), queryFn: readTasks });
    applyTeamStreamEvent(qc, TEAM, event(next));
    todos.release([old, { ...kept, v: 3 }]);
    tasks.release({ entries: [taskRow(old)] });
    await Promise.all([fetchingTodos, fetchingTasks]);

    expect(qc.getQueryData(todoList)).toEqual([next, kept]);
    expect(qc.getQueryData(taskList)).toEqual({ entries: [taskRow(next)] });
    expect(qc.getQueryState(todoList)).toMatchObject({ isInvalidated: true, fetchStatus: 'fetching' });
    expect(qc.getQueryState(taskList)).toMatchObject({ isInvalidated: true, fetchStatus: 'fetching' });
    expect(readTodos).toHaveBeenCalledTimes(2);
    expect(readTasks).toHaveBeenCalledTimes(2);
    freshTodos.release([next, kept]);
    freshTasks.release({ entries: [taskRow(next)] });
    await vi.waitFor(() => {
      expect(qc.getQueryState(todoList)?.isInvalidated).toBe(false);
      expect(qc.getQueryState(taskList)?.isInvalidated).toBe(false);
    });
  });

  it('never drops a pushed todo from a published list when an older list did not have it', async () => {
    const qc = client();
    const target = row(1, 'building', { v: 6 });
    const earlier = held<WireTodo[]>();
    const options = todosQuery(TEAM);
    const queryFn = vi.fn<() => Promise<WireTodo[]>>()
      .mockReturnValueOnce(earlier.pending)
      .mockResolvedValue([target]);
    qc.setQueryData(options.queryKey, []);
    const observer = new QueryObserver(qc, { ...options, queryFn, staleTime: Infinity });
    const published: (number[] | undefined)[] = [];
    const stop = observer.subscribe(({ data }) => published.push(data?.map(({ v }) => v)));
    try {
      const fetching = qc.fetchQuery({ ...options, queryFn, staleTime: 0 });
      applyTeamStreamEvent(qc, TEAM, event(target));
      expect(published.at(-1)).toEqual([6]);
      const pushed = published.length - 1;
      earlier.release([]);
      await fetching;
      await vi.waitFor(() => expect(observer.getCurrentResult().isFetching).toBe(false));

      const afterPush = published.slice(pushed);
      expect(afterPush.filter((versions) => versions?.[0] !== 6)).toEqual([]);
      expect(queryFn).toHaveBeenCalledTimes(2);
    } finally {
      stop();
      qc.clear();
    }
  });

  function observeRead<T, Visible>(
    qc: QueryClient,
    options: { queryKey: readonly unknown[] },
    initial: T | undefined,
    project: (data: T | undefined) => Visible,
  ) {
    const earlier = held<T>();
    const later = held<T>();
    const cancelled = vi.fn();
    const queryFn = vi.fn<(context: { signal: AbortSignal }) => Promise<T>>()
      .mockImplementationOnce(({ signal }) => {
        signal.addEventListener('abort', cancelled);
        return earlier.pending;
      })
      .mockReturnValue(later.pending);
    qc.setQueryData(options.queryKey, initial);
    const observer = new QueryObserver(qc, { ...options, queryFn, staleTime: Infinity });
    const published: Visible[] = [];
    const stop = observer.subscribe(({ data }) => published.push(project(data)));
    const fetching = qc.fetchQuery({ ...options, queryFn, staleTime: 0 });
    return { earlier, later, cancelled, queryFn, observer, published, stop, fetching };
  }

  it('never resurrects a todo absent from the published board when a pre-archive GET returns it', async () => {
    const qc = client();
    const target = row(1, 'done', { section: 'resolved' });
    const archived = { ...target, archivedAt: 5, section: null, v: target.v + 1 };
    const board = observeRead(qc, todosQuery(TEAM), [] as WireTodo[], (data) => data);
    const tasks = observeRead(qc, tasksQuery(TEAM), { entries: [] } as TasksQuery, (data) => data);
    const archive = observeRead<WireTodo[], WireTodo[] | undefined>(
      qc, { queryKey: ['todos', TEAM, 'archived'] }, undefined, (data) => data,
    );
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    const stop = startTeamStream(TEAM, qc);
    try {
      const source = FakeEventSource.instances[0];
      if (source === undefined) throw new Error('Expected a team stream');
      source.fireOpen();
      const from = board.published.length;
      const tasksFrom = tasks.published.length;
      source.push(event(archived));
      board.earlier.release([target]);
      tasks.earlier.release({ entries: [taskRow(target)] });
      archive.earlier.release([]);
      await Promise.allSettled([board.fetching, tasks.fetching, archive.fetching]);

      expect(board.published.slice(from).flat()).not.toContainEqual(target);
      const publishedTasks = tasks.published.slice(tasksFrom).flatMap((data) => data?.entries ?? []);
      expect(publishedTasks).not.toContainEqual(taskRow(target));
      for (const read of [board, tasks, archive]) {
        expect(read.cancelled).toHaveBeenCalledOnce();
        expect(read.queryFn).toHaveBeenCalledTimes(2);
      }
      board.later.release([]);
      tasks.later.release({ entries: [] });
      archive.later.release([archived]);
      await vi.waitFor(() => expect(archive.observer.getCurrentResult().data).toEqual([archived]));
      expect(board.observer.getCurrentResult().data).toEqual([]);
      expect(tasks.observer.getCurrentResult().data).toEqual({ entries: [] });
    } finally {
      stop();
      board.stop();
      tasks.stop();
      archive.stop();
      qc.clear();
      vi.unstubAllGlobals();
      FakeEventSource.instances = [];
    }
  });

  it('publishes an equal-version quota wait immediately and never rolls back to the pre-event GET', async () => {
    const qc = client();
    const current = row(1, 'building', { section: 'up_next', quotaWait: null });
    const quotaWait = {
      kind: 'quota' as const,
      providerId: 'provider-1',
      label: null,
      retryAfterMs: null,
      probeAt: 60_000,
    };
    const waiting = { ...current, quotaWait };
    const detail = observeRead(qc, todoQuery(current.id), current, (data) => data?.quotaWait);
    const board = observeRead(qc, todosQuery(TEAM), [current], (data) => data?.[0]?.quotaWait);
    const tasks = observeRead<TasksQuery, WireTodo['quotaWait']>(
      qc, tasksQuery(TEAM), { entries: [taskRow(current)] }, (data) => {
        const entry = data?.entries[0];
        return entry?.kind === 'todo' ? entry.quotaWait : undefined;
      },
    );
    try {
      const reads = [detail, board, tasks];
      applyTeamStreamEvent(qc, TEAM, event(waiting));
      for (const read of reads) expect(read.published.at(-1)).toEqual(quotaWait);
      const afterPush = reads.map((read) => read.published.length - 1);
      detail.earlier.release(current);
      board.earlier.release([current]);
      tasks.earlier.release({ entries: [taskRow(current)] });
      await Promise.allSettled(reads.map((read) => read.fetching));
      reads.forEach((read, index) => {
        expect(read.cancelled).toHaveBeenCalledOnce();
        expect(read.queryFn).toHaveBeenCalledTimes(2);
        expect(read.published.slice(afterPush[index])).not.toContain(null);
      });
      applyTeamStreamEvent(qc, TEAM, event(current));
      for (const read of reads) expect(read.published.at(-1)).toBeNull();
      detail.later.release(current);
      board.later.release([current]);
      tasks.later.release({ entries: [taskRow(current)] });
    } finally {
      detail.stop();
      board.stop();
      tasks.stop();
      qc.clear();
    }
  });

  it('replaces pre-event build and parent reads without publishing the unversioned build frame', async () => {
    const qc = client();
    const buildKey = ['build', build.id];
    const projectKey = ['projectBuilds', 'project-1'];
    const searchKey = ['search', 'pr:any'];
    const stale = { ...build, errorMessage: 'old response' };
    const frame = { ...build, errorMessage: 'event document', prNumber: 42 };
    const fresh = { ...build, prNumber: 42 };
    const parent = row(1, 'building');
    const current = { ...parent, title: 'linked to a pull request' };
    const buildRead = observeRead(qc, { queryKey: buildKey }, build, (data) => data);
    const project = observeRead(qc, { queryKey: projectKey }, [] as BuildRecord[], (data) => data);
    const search = observeRead(qc, { queryKey: searchKey }, [] as string[], (data) => data);
    const detail = observeRead(qc, todoQuery(build.todoId), parent, (data) => data);
    const otherKey = ['todos', 'other-team'];
    qc.setQueryData(otherKey, []);
    const reads = [buildRead, project, search, detail];
    try {
      applyTeamStreamEvent(qc, TEAM, { type: 'build', projectId: 'project-1', doc: frame });
      expect(buildRead.observer.getCurrentResult().data).toEqual(build);
      buildRead.earlier.release(stale);
      project.earlier.release([stale]);
      search.earlier.release(['old']);
      detail.earlier.release(parent);
      await Promise.allSettled(reads.map((read) => read.fetching));
      for (const read of reads) {
        expect(read.cancelled).toHaveBeenCalledOnce();
        expect(read.queryFn).toHaveBeenCalledTimes(2);
      }
      buildRead.later.release(fresh);
      project.later.release([fresh]);
      search.later.release([parent.id]);
      detail.later.release(current);
      await vi.waitFor(() => {
        expect(reads.every((read) => !read.observer.getCurrentResult().isFetching)).toBe(true);
      });
      expect(buildRead.published).not.toContainEqual(stale);
      expect(buildRead.published).not.toContainEqual(frame);
      expect(buildRead.observer.getCurrentResult().data).toEqual(fresh);
      expect(project.observer.getCurrentResult().data).toEqual([fresh]);
      expect(search.observer.getCurrentResult().data).toEqual([parent.id]);
      expect(detail.observer.getCurrentResult().data).toEqual(current);
      expect(qc.getQueryState(otherKey)?.isInvalidated).toBe(false);
    } finally {
      for (const read of reads) read.stop();
      qc.clear();
    }
  });

  it('takes a newer fetch over an older cached row', async () => {
    const qc = client();
    applyTeamStreamEvent(qc, TEAM, event(row(1, 'queued', { v: 5 })));
    await qc.fetchQuery({ ...todoQuery('todo-1'), queryFn: async () => row(1, 'building', { v: 6 }) });
    expect(qc.getQueryData<WireTodo>(['todo', 'todo-1'])?.phase).toBe('building');
  });
});
