import { type BuildRecord, type ConversationMessagesResponse, todoRecordSchema } from '@cairn/shared';
import { type InfiniteData, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { keepNewestMessagesPage } from '../src/api/hooks.js';
import { STREAM_REFRESH_QUIET_MS } from '../src/api/invalidate.js';
import { liveTextStore } from '../src/api/live-text.js';
import { SSE_BIZ_SILENCE_BASE_MS } from '../src/api/sse-connection.js';
import { startConversationStream, startTeamStream } from '../src/api/sse.js';
import { todo } from './helpers.js';
import { FakeEventSource } from './tab-stream-harness.js';

type Follow = { conversationIds: string[]; revision?: number };
const stops: (() => void)[] = [];
const writes: { path: string; body: Follow }[] = [];
const fetchFollow = vi.fn<(path: string, body: Follow) => Promise<Response>>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function acknowledge(body: Follow) {
  return Response.json({ revision: body.revision });
}

function source() {
  const stream = FakeEventSource.instances.at(-1);
  if (stream === undefined) throw new Error('No stream');
  return stream;
}

function hello(id: string, modern = true) {
  const stream = source();
  stream.fireOpen();
  stream.push({ type: 'hello', connectionId: id, ...(modern ? { followRevision: true } : {}) });
  stream.push({ type: 'ping' });
  return stream;
}

function conversation(stream: FakeEventSource, id: string, event: object) {
  stream.push({ type: 'conversation', conversationId: id, event });
}

function todoFrame(phase: 'building' | 'review') {
  return {
    type: 'todo',
    doc: todoRecordSchema.parse({
      ...todo(1, phase),
      teamId: 'team-1',
      projectId: 'project-a',
      latestBuildId: 'build-a',
      createdBy: 'user-1',
      ownerId: null,
      sourceBuildId: null,
      sourceKind: null,
      sourceRef: null,
    }),
  };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  writes.length = 0;
  fetchFollow.mockReset().mockImplementation(async (_path, body) => acknowledge(body));
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(cb, 16));
  vi.stubGlobal('fetch', (path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Follow;
    writes.push({ path, body });
    return fetchFollow(path, body);
  });
});

afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test.each(['ticket', 'stream', 'empty stream'])(
  'failed initial %s retries without reporting a disconnect and refreshes stale watched data',
  async (failure) => {
    vi.useFakeTimers();
    const path = '/api/teams/team-1/stream';
    const resolvePath = vi.fn<() => Promise<string>>().mockResolvedValue(path);
    if (failure === 'ticket') resolvePath.mockRejectedValueOnce(new Error('Ticket unavailable'));
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const key = ['tasks', 'team-1'];
    const read = vi.fn().mockResolvedValue('fresh after retry');
    qc.setQueryData(key, 'before retry');
    const observer = new QueryObserver(qc, { queryKey: key, queryFn: read });
    stops.push(observer.subscribe(() => {}));
    const status = vi.fn();
    stops.push(startTeamStream('team-1', qc, 0, null, resolvePath, status));
    await vi.advanceTimersByTimeAsync(0);
    if (failure === 'ticket') expect(FakeEventSource.instances).toHaveLength(0);
    else {
      if (failure === 'empty stream') source().fireOpen();
      source().onerror?.();
    }
    expect(status).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    hello('first-healthy');
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);
    expect(read).toHaveBeenCalledOnce();
    expect(qc.getQueryData(key)).toBe('fresh after retry');
    expect(status).not.toHaveBeenCalled();
  },
);

test('a rejected first follow can replace an open attachment without announcing a transport loss', async () => {
  vi.useFakeTimers();
  fetchFollow.mockResolvedValueOnce(new Response(null, { status: 404 }));
  const qc = new QueryClient();
  const status = vi.fn();
  stops.push(startTeamStream('team-1', qc, 0, null, null, status));
  const first = hello('retired');
  await vi.advanceTimersByTimeAsync(0);
  expect(first.readyState).toBe(FakeEventSource.CLOSED);
  hello('replacement');
  await vi.advanceTimersByTimeAsync(0);
  expect(writes).toHaveLength(2);
  expect(status).not.toHaveBeenCalled();
});

test('rejoins with the whole set and drops previews and callbacks from the retired stream', async () => {
  const qc = new QueryClient();
  const status = vi.fn();
  stops.push(startTeamStream('team-1', qc, 0, null, null, status));
  stops.push(startConversationStream('conv-a', qc, {}));
  const first = hello('first');
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  conversation(first, 'conv-a', { type: 'text_delta', text: 'old prefix' });
  expect(liveTextStore.get('conv-a')).toBe('old prefix');
  first.onerror?.();
  expect(status).toHaveBeenLastCalledWith(true);
  const next = hello('next');
  expect(liveTextStore.get('conv-a')).toBe('');
  conversation(first, 'conv-a', { type: 'text_delta', text: 'retired' });
  conversation(next, 'conv-a', { type: 'text_delta', text: 'snapshot' });
  conversation(next, 'conv-a', { type: 'text_delta', text: ' and delta' });
  await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith(false));
  expect(liveTextStore.get('conv-a')).toBe('snapshot and delta');
  expect(writes).toEqual([
    { path: '/api/streams/first/conversations', body: { conversationIds: ['conv-a'], revision: expect.any(Number) } },
    { path: '/api/streams/next/conversations', body: { conversationIds: ['conv-a'], revision: expect.any(Number) } },
  ]);
});

test('an acknowledged reconnect replaces running reads and leaves idle inactive entries stale', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const activeKey = ['tasks', 'team-1'];
  const inactiveKey = ['messages', 'prefetched'];
  const idleKey = ['messages', 'unopened'];
  const active = deferred<string>();
  const inactive = deferred<string>();
  const cancelled = vi.fn();
  const activeRead = vi.fn().mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
    signal.addEventListener('abort', cancelled);
    return active.promise;
  }).mockResolvedValue('fresh');
  const inactiveRead = vi.fn().mockReturnValueOnce(inactive.promise).mockResolvedValue('fresh');
  const idleRead = vi.fn().mockResolvedValue('fresh');
  await qc.fetchQuery({ queryKey: idleKey, queryFn: idleRead });
  qc.setQueryData(activeKey, 'cached');
  const observing = new QueryObserver(qc, { queryKey: activeKey, queryFn: activeRead });
  stops.push(observing.subscribe(() => {}));
  const status = vi.fn();
  stops.push(startTeamStream('team-1', qc, 0, null, null, status));
  const first = hello('first');
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  const reading = qc.fetchQuery({ queryKey: activeKey, queryFn: activeRead, staleTime: 0 });
  const prefetch = qc.fetchQuery({ queryKey: inactiveKey, queryFn: inactiveRead });
  const interrupted = Promise.allSettled([reading, prefetch]);
  first.onerror?.();
  hello('next');
  await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith(false));
  expect(cancelled).toHaveBeenCalledOnce();
  expect(activeRead).toHaveBeenCalledTimes(2);
  expect(inactiveRead).toHaveBeenCalledTimes(2);
  inactive.resolve('older unopened result');
  active.resolve('older observed result');
  await interrupted;
  expect(qc.getQueryData(activeKey)).toBe('fresh');
  expect(qc.getQueryData(inactiveKey)).toBe('fresh');
  expect(qc.getQueryState(idleKey)?.isInvalidated).toBe(true);
  expect(idleRead).toHaveBeenCalledTimes(1);
  const unopened = new QueryObserver(qc, { queryKey: idleKey, queryFn: idleRead });
  stops.push(unopened.subscribe(() => {}));
  await vi.waitFor(() => expect(idleRead).toHaveBeenCalledTimes(2));
});

test('reconnect stays visible until a live frame’s successor read and the other recovery reads settle', async () => {
  vi.useFakeTimers();
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const plansKey = ['plans', 'build-a'];
  const recovery = deferred<string[]>();
  const successor = deferred<string[]>();
  const unrelated = deferred<string>();
  const abort = vi.fn();
  const readPlans = vi.fn<({ signal }: { signal: AbortSignal }) => Promise<string[]>>()
    .mockImplementationOnce(({ signal }) => {
      signal.addEventListener('abort', abort);
      return recovery.promise;
    })
    .mockReturnValueOnce(successor.promise);
  const otherKey = ['session'];
  qc.setQueryData(plansKey, ['before reconnect']);
  qc.setQueryData(otherKey, 'before reconnect');
  const plans = new QueryObserver(qc, { queryKey: plansKey, queryFn: readPlans });
  const other = new QueryObserver(qc, { queryKey: otherKey, queryFn: () => unrelated.promise });
  stops.push(plans.subscribe(() => {}), other.subscribe(() => {}));
  const status = vi.fn();
  stops.push(startTeamStream('team-1', qc, 0, null, null, status));
  stops.push(startConversationStream('build-a', qc, {}));
  const first = hello('first');
  await vi.advanceTimersByTimeAsync(0);
  first.onerror?.();
  const next = hello('next');
  await vi.advanceTimersByTimeAsync(0);
  expect(readPlans).toHaveBeenCalledTimes(1);

  conversation(next, 'build-a', { type: 'step', step: { status: 'stopped' } });
  unrelated.resolve('fresh session');
  await vi.advanceTimersByTimeAsync(0);
  expect(abort).toHaveBeenCalledOnce();
  expect(readPlans).toHaveBeenCalledTimes(2);
  expect(plans.getCurrentResult().fetchStatus).toBe('fetching');
  expect(status.mock.calls).toEqual([[true]]);

  successor.resolve(['fresh plan']);
  await vi.advanceTimersByTimeAsync(0);
  expect(qc.getQueryData(plansKey)).toEqual(['fresh plan']);
  expect(status.mock.calls).toEqual([[true], [false]]);
});

test.each(['success', 'failure', 'unmount'] as const)(
  'reconnect waits for a queued search read to settle by %s',
  async (outcome) => {
    vi.useFakeTimers();
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    const key = ['search', 'pr:any'];
    const recovery = deferred<{ todos: unknown[] }>();
    const followUp = deferred<{ todos: unknown[] }>();
    const queryFn = vi.fn().mockReturnValueOnce(recovery.promise).mockReturnValueOnce(
      outcome === 'failure'
        ? followUp.promise.then(() => { throw new Error('Search unavailable'); })
        : followUp.promise,
    );
    qc.setQueryData(key, { todos: [] });
    const stopObserving = new QueryObserver(qc, { queryKey: key, queryFn }).subscribe(() => {});
    stops.push(stopObserving);
    const status = vi.fn();
    stops.push(startTeamStream('team-1', qc, 0, null, null, status));
    const first = hello('first');
    await vi.advanceTimersByTimeAsync(0);
    first.onerror?.();
    const next = hello('next');
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledOnce();

    next.push(todoFrame('review'));
    recovery.resolve({ todos: [] });
    await vi.advanceTimersByTimeAsync(STREAM_REFRESH_QUIET_MS - 1);
    expect(status.mock.calls).toEqual([[true]]);
    expect(queryFn).toHaveBeenCalledOnce();

    if (outcome === 'unmount') {
      stopObserving();
      await vi.advanceTimersByTimeAsync(STREAM_REFRESH_QUIET_MS);
      expect(queryFn).toHaveBeenCalledOnce();
    } else {
      await vi.advanceTimersByTimeAsync(1);
      expect(queryFn).toHaveBeenCalledTimes(2);
      expect(status.mock.calls).toEqual([[true]]);
      followUp.resolve({ todos: [{ id: 'fresh' }] });
      await vi.advanceTimersByTimeAsync(0);
      if (outcome === 'success') expect(qc.getQueryData(key)).toEqual({ todos: [{ id: 'fresh' }] });
      else expect(qc.getQueryState(key)?.error?.message).toBe('Search unavailable');
    }
    expect(status.mock.calls).toEqual([[true], [false]]);
  },
);

test.each(['during', 'after'])('a build frame %s a GET cannot replace the last committed build if the refresh fails', async (arrival) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const build: BuildRecord = {
    id: 'build-1', todoId: 'todo-1', withPlan: false, prevPhase: null, triggerSource: 'user',
    planDocId: null, errorMessage: null, prUrl: null, prNumber: null, diffHash: null, createdAt: 1,
  };
  const old = { ...build, errorMessage: 'Earlier failure' };
  const key = ['build', build.id];
  const pending = deferred<BuildRecord>();
  const queryFn = vi.fn<() => Promise<BuildRecord>>()
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValue(new Error('Follow-up GET failed'));
  if (arrival === 'during') qc.setQueryData(key, build);
  const observer = new QueryObserver(qc, { queryKey: key, queryFn, staleTime: Infinity });
  const published: (BuildRecord | undefined)[] = [];
  stops.push(observer.subscribe(({ data }) => published.push(data)));
  const reading = observer.refetch({ cancelRefetch: false });
  stops.push(startTeamStream('team-1', qc));
  const stream = hello('build-stream');
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  const frame = { type: 'build', v: 1, doc: old };
  if (arrival === 'during') stream.push(frame);
  pending.resolve(arrival === 'during' ? { ...build, errorMessage: 'Pre-event response' } : build);
  await reading;
  if (arrival === 'after') {
    expect(observer.getCurrentResult().data).toEqual(build);
    stream.push(frame);
  }
  await vi.waitFor(() => expect(observer.getCurrentResult().isFetching).toBe(false));

  expect(published.filter((value) => value !== undefined && value.errorMessage !== null)).toEqual([]);
  expect(observer.getCurrentResult().data).toEqual(build);
  expect(observer.getCurrentResult().error?.message).toBe('Follow-up GET failed');
  expect(queryFn).toHaveBeenCalledTimes(2);
});

test('a pre-stop steps read cannot publish claimed even when the replacement fails', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ['steps', 'build-a'];
  const earlier = deferred<string[]>();
  const queryFn = vi.fn<() => Promise<string[]>>()
    .mockReturnValueOnce(earlier.promise)
    .mockRejectedValue(new Error('Steps unavailable'));
  qc.setQueryData(key, ['pending']);
  const observer = new QueryObserver(qc, { queryKey: key, queryFn, staleTime: Infinity });
  const published: (string[] | undefined)[] = [];
  stops.push(observer.subscribe(({ data }) => published.push(data)));
  stops.push(startTeamStream('team-1', qc));
  stops.push(startConversationStream('build-a', qc, {}));
  const stream = hello('step-stream');
  const read = observer.refetch();

  conversation(stream, 'build-a', { type: 'step', step: { status: 'stopped' } });
  earlier.resolve(['claimed']);
  await read;
  await vi.waitFor(() => expect(observer.getCurrentResult().error?.message).toBe('Steps unavailable'));

  expect(published).not.toContainEqual(['claimed']);
  expect(qc.getQueryData(key)).toEqual(['pending']);
  expect(queryFn).toHaveBeenCalledTimes(2);
});

test.each(['todo', 'build'] as const)('a project A %s frame replaces only project A’s builds read', async (type) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const observeBuilds = (projectId: string) => {
    const earlier = deferred<BuildRecord[]>();
    const cancelled = vi.fn();
    const queryFn = vi.fn<({ signal }: { signal: AbortSignal }) => Promise<BuildRecord[]>>()
      .mockImplementationOnce(({ signal }) => {
        signal.addEventListener('abort', cancelled);
        return earlier.promise;
      })
      .mockResolvedValue([]);
    const observer = new QueryObserver(qc, { queryKey: ['projectBuilds', projectId], queryFn });
    stops.push(observer.subscribe(() => {}));
    return { earlier, cancelled, queryFn, observer };
  };
  const a = observeBuilds('project-a');
  const b = observeBuilds('project-b');
  stops.push(startTeamStream('team-1', qc));
  const stream = hello('project-stream');
  const todo = todoFrame('building');
  const build: BuildRecord = {
    id: 'build-a', todoId: todo.doc.id, withPlan: false, prevPhase: null, triggerSource: 'user',
    planDocId: null, errorMessage: null, prUrl: null, prNumber: null, diffHash: null, createdAt: 1,
  };
  stream.push(type === 'todo' ? todo : { type, doc: build, projectId: 'project-a' });
  a.earlier.resolve([]);
  b.earlier.resolve([]);
  await vi.waitFor(() => expect(b.observer.getCurrentResult().isSuccess).toBe(true));

  expect(a.cancelled).toHaveBeenCalledOnce();
  expect(a.queryFn).toHaveBeenCalledTimes(2);
  expect(b.cancelled).not.toHaveBeenCalled();
  expect(b.queryFn).toHaveBeenCalledTimes(1);
});

test('a legacy todo frame refreshes saved transcript rows without a message frame', async () => {
  fetchFollow.mockResolvedValue(new Response(null, { status: 204 }));
  const qc = new QueryClient();
  const queryKey = ['messages', 'build-a', 'pages'];
  const queryFn = vi.fn().mockResolvedValueOnce([]).mockResolvedValue(['saved deliverable']);
  qc.setQueryData(queryKey, []);
  const observer = new QueryObserver(qc, { queryKey, queryFn, staleTime: Infinity });
  stops.push(observer.subscribe(() => {}));
  stops.push(startTeamStream('team-1', qc));
  stops.push(startConversationStream('build-a', qc, {}));
  const stream = hello('legacy-stream', false);
  await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(qc.getQueryState(queryKey)?.fetchStatus).toBe('idle'));
  queryFn.mockClear();
  stream.push(todoFrame('review'));

  await vi.waitFor(() => expect(qc.getQueryData(queryKey)).toEqual(['saved deliverable']));
  expect(queryFn).toHaveBeenCalledOnce();
});

test('explicit rejection resends plain follows and a timed-out legacy write retires the attachment', async () => {
  vi.useFakeTimers();
  const retiredWrite = deferred<Response>();
  fetchFollow.mockImplementation(async (path, body) => {
    if (body.revision !== undefined) return new Response(null, { status: 400 });
    if (path.includes('/old/') && body.conversationIds.includes('conv-b')) return retiredWrite.promise;
    return new Response(null, { status: 204 });
  });
  const qc = new QueryClient();
  stops.push(startTeamStream('team-1', qc));
  stops.push(startConversationStream('conv-a', qc, {}));
  const first = hello('old', false);
  await vi.advanceTimersByTimeAsync(0);
  expect(writes.map((write) => write.body)).toEqual([
    { conversationIds: ['conv-a'], revision: expect.any(Number) },
    { conversationIds: ['conv-a'] },
  ]);
  conversation(first, 'conv-a', { type: 'text_delta', text: 'not a saved row' });
  expect(liveTextStore.get('conv-a')).toBe('');
  stops.push(startConversationStream('conv-b', qc, {}));
  await vi.advanceTimersByTimeAsync(0);
  first.push({ type: 'ping' });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(first.readyState).toBe(FakeEventSource.CLOSED);
  hello('replacement', false);
  await vi.advanceTimersByTimeAsync(0);
  expect(writes.at(-1)).toEqual({
    path: '/api/streams/replacement/conversations',
    body: { conversationIds: ['conv-a', 'conv-b'] },
  });
  const completed = [...writes];
  retiredWrite.resolve(new Response(null, { status: 204 }));
  await vi.advanceTimersByTimeAsync(0);
  expect(writes).toEqual(completed);
  expect(writes.filter((write) => write.path.includes('/old/'))).toHaveLength(3);
});

test('a superseded follow acknowledgment does not settle recovery or block live updates', async () => {
  vi.useFakeTimers();
  const status = vi.fn();
  const qc = new QueryClient();
  stops.push(startTeamStream('team-1', qc, 0, null, null, status));
  stops.push(startConversationStream('conv-a', qc, {}));
  const first = hello('first');
  await vi.advanceTimersByTimeAsync(0);
  first.onerror?.();
  const early = deferred<Response>();
  const latest = deferred<Response>();
  fetchFollow.mockReturnValueOnce(early.promise).mockReturnValueOnce(latest.promise);
  const replacement = hello('replacement');
  const original = writes.at(-1)!.body;
  stops.push(startConversationStream('conv-b', qc, {}));
  early.resolve(acknowledge(original));
  await vi.advanceTimersByTimeAsync(0);
  const current = writes.at(-1)!.body;
  expect(current.conversationIds).toEqual(['conv-a', 'conv-b']);
  expect(current.revision).toBeGreaterThan(original.revision!);
  expect(status.mock.calls).toEqual([[true]]);
  conversation(replacement, 'conv-a', { type: 'text_delta', text: 'while recovering' });
  expect(liveTextStore.get('conv-a')).toBe('while recovering');
  latest.resolve(acknowledge(current));
  await vi.advanceTimersByTimeAsync(0);
  expect(status.mock.calls).toEqual([[true], [false]]);
});

test('business silence is measured from the current follow acknowledgment, not socket open', async () => {
  vi.useFakeTimers();
  const ack = deferred<Response>();
  fetchFollow.mockReturnValueOnce(ack.promise);
  const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
  const qc = new QueryClient();
  stops.push(startTeamStream('team-1', qc));
  stops.push(startConversationStream('conv-a', qc, {}));
  const stream = hello('first');
  invalidate.mockClear();
  conversation(stream, 'conv-a', { type: 'text_delta', text: 'running' });
  await vi.advanceTimersByTimeAsync(5_000);
  ack.resolve(acknowledge(writes[0]!.body));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(10_000);
  stream.push({ type: 'ping' });
  await vi.advanceTimersByTimeAsync(SSE_BIZ_SILENCE_BASE_MS - 10_001);
  expect(invalidate).not.toHaveBeenCalled();
  stream.push({ type: 'ping' });
  await vi.advanceTimersByTimeAsync(1);
  expect(invalidate).toHaveBeenCalled();
  invalidate.mockRestore();
});

test('a failing follow PUT cannot disable team-stream business-silence or frame-gap reconciliation', async () => {
  vi.useFakeTimers();
  fetchFollow.mockRejectedValue(new TypeError('Failed to fetch'));
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const todoKey = ['todo', 'todo-1'];
  const todoRead = vi
    .fn()
    .mockResolvedValueOnce({ ...todo(1, 'confirm'), v: 2 })
    .mockResolvedValue({ ...todo(1, 'confirm'), v: 3 });
  qc.setQueryData(todoKey, todo(1, 'planning'));
  const observer = new QueryObserver(qc, { queryKey: todoKey, queryFn: todoRead });
  stops.push(observer.subscribe(() => {}));
  stops.push(startTeamStream('team-1', qc));
  stops.push(startConversationStream('build-a', qc, { todoId: 'todo-1' }));

  const stream = source();
  stream.fireOpen();
  stream.push({ type: 'hello', connectionId: 'first', followRevision: true }, 1);
  stream.push({ type: 'ping' }, 2);
  await vi.advanceTimersByTimeAsync(0);
  expect(todoRead).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(15_000);
  stream.push({ type: 'ping' }, 3);
  await vi.advanceTimersByTimeAsync(SSE_BIZ_SILENCE_BASE_MS - 15_001);
  expect(todoRead).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(todoRead).toHaveBeenCalledTimes(1);
  expect(qc.getQueryData<{ phase: string }>(todoKey)?.phase).toBe('confirm');

  stream.push({ type: 'ping' }, 5);
  await vi.advanceTimersByTimeAsync(0);
  expect(todoRead).toHaveBeenCalledTimes(2);
});

test('an external cancellation without a replacement read settles recovery instead of leaving reconnecting stuck', async () => {
  vi.useFakeTimers();
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const convId = 'chief-trim';
  const key = ['messages', convId, 'pages'];
  const page = {
    messages: [],
    chips: null,
    historyEpoch: 0,
    steerPending: [],
    activeRun: null,
    nextCursor: 'cursor-1',
  };
  const twoPages: InfiniteData<ConversationMessagesResponse, string | null> = {
    pages: [page, { ...page, nextCursor: null }],
    pageParams: [null, 'cursor-1'],
  };
  const recovery = deferred<typeof twoPages>();
  const read = vi.fn().mockReturnValue(recovery.promise);
  qc.setQueryData(key, twoPages);
  const observer = new QueryObserver(qc, { queryKey: key, queryFn: read });
  stops.push(observer.subscribe(() => {}));
  const status = vi.fn();
  stops.push(startTeamStream('team-1', qc, 0, null, null, status));
  const first = hello('first');
  await vi.advanceTimersByTimeAsync(0);
  first.onerror?.();
  hello('next');
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledOnce();
  expect(status.mock.calls).toEqual([[true]]);

  await keepNewestMessagesPage(qc, convId);
  await vi.advanceTimersByTimeAsync(0);
  expect(qc.getQueryData<typeof twoPages>(key)?.pages).toHaveLength(1);
  expect(status.mock.calls).toEqual([[true], [false]]);
});

test('cold transcript watch keeps its single mount GET while a cached transcript refreshes only after follow acknowledgment', async () => {
  vi.useFakeTimers();
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const coldKey = ['messages', 'chief-cold', 'pages'];
  const warmKey = ['messages', 'chief-warm', 'pages'];
  const mountRead = deferred<string[]>();
  const coldRead = vi.fn().mockReturnValue(mountRead.promise);
  const warmRead = vi.fn().mockResolvedValue(['after-ack']);
  qc.setQueryData(warmKey, ['prefetched']);
  const coldObserver = new QueryObserver(qc, { queryKey: coldKey, queryFn: coldRead });
  const warmObserver = new QueryObserver(qc, { queryKey: warmKey, queryFn: warmRead });
  stops.push(coldObserver.subscribe(() => {}), warmObserver.subscribe(() => {}));

  const ack = deferred<Response>();
  stops.push(startTeamStream('team-1', qc));
  hello('first');
  await vi.advanceTimersByTimeAsync(0);

  fetchFollow.mockReturnValueOnce(ack.promise);
  stops.push(
    startConversationStream('chief-cold', qc, {}),
    startConversationStream('chief-warm', qc, {}),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(coldRead).toHaveBeenCalledOnce();
  expect(warmRead).not.toHaveBeenCalled();

  mountRead.resolve(['cold-page']);
  ack.resolve(acknowledge(writes.at(-1)!.body));
  await vi.advanceTimersByTimeAsync(0);
  expect(coldRead).toHaveBeenCalledOnce();
  expect(qc.getQueryData(coldKey)).toEqual(['cold-page']);
  expect(warmRead).toHaveBeenCalledOnce();
  expect(qc.getQueryData(warmKey)).toEqual(['after-ack']);
});
