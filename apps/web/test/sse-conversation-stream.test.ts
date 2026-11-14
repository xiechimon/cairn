import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activityStore } from '../src/api/activity.js';
import { agentTodoStore } from '../src/api/agent-todo.js';
import { liveTextStore } from '../src/api/live-text.js';
import { liveThinkingStore } from '../src/api/live-thinking.js';
import { startConversationStream } from '../src/api/sse.js';

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readyState: number = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
  fireOpen(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  push(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const CONV = 'chief-t-740';

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function startStream(qc: QueryClient): FakeEventSource {
  FakeEventSource.instances = [];
  startConversationStream(CONV, qc, {});
  const es = FakeEventSource.instances[0] as FakeEventSource;
  es.fireOpen();
  return es;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(cb, 16));
  liveTextStore.clear(CONV);
  liveThinkingStore.clear(CONV);
  activityStore.clear(CONV);
  agentTodoStore.clear(CONV);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  liveTextStore.clear(CONV);
  liveThinkingStore.clear(CONV);
  activityStore.clear(CONV);
  agentTodoStore.clear(CONV);
});

describe('confirmed user message visibility', () => {
  it('hands a source-stream rollover confirmation to the target cache before subscribing there', () => {
    const qc = freshClient();
    const onMessage = vi.fn();
    const delivered = { id: 'delivered-rollover', role: 'user', content: 'Identical words', createdAt: 5 };
    const keep = { id: 'keep-queued', content: delivered.content, createdAt: 2 };
    const envelope = { messages: [], chips: null, historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null, queuedMessages: [{ ...keep, id: 'source-queued' }, keep] };
    qc.setQueryData(['messages', CONV, 'pages'], { pages: [envelope], pageParams: [null] });
    const stopSource = startConversationStream(CONV, qc, { onMessage });
    const source = FakeEventSource.instances.at(-1)!;
    source.fireOpen();
    const event = { type: 'message', conversationId: 'replacement-build', message: delivered, deliveredQueue: { conversationId: CONV, messageId: 'source-queued' } };
    source.push(event);
    expect(qc.getQueryData(['messages', CONV, 'pages'])).toMatchObject({ pages: [{ messages: [], queuedMessages: [keep] }] });
    expect(qc.getQueryData(['messages', 'replacement-build', 'pages'])).toMatchObject({ pages: [{ messages: [delivered] }] });
    expect(onMessage).toHaveBeenCalledWith(delivered);
    const stopTarget = startConversationStream('replacement-build', qc, {});
    const target = FakeEventSource.instances.at(-1)!;
    target.fireOpen();
    target.push({ type: 'message', message: delivered, deliveredQueue: event.deliveredQueue });
    source.push(event);
    expect(qc.getQueryData(['messages', 'replacement-build', 'pages'])).toMatchObject({ pages: [{ messages: [delivered] }] });
    expect(qc.getQueryData(['messages', CONV, 'pages'])).toMatchObject({ pages: [{ messages: [], queuedMessages: [keep] }] });
    stopSource();
    stopTarget();
    qc.clear();
  });

  it.each([CONV, 'replacement-build'])('correlates automatic queue delivery into %s by identity, not equal content', (target) => {
    const qc = freshClient();
    const delivered = { id: 'delivered', role: 'user', content: 'Identical words', createdAt: 5 };
    const keep = { id: 'keep-queued', content: delivered.content, createdAt: 2 };
    const envelope = { messages: [], chips: null, historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null, queuedMessages: [{ ...keep, id: 'source-queued' }, keep] };
    qc.setQueryData(['messages', CONV, 'pages'], { pages: [envelope], pageParams: [null] });
    const stop = startConversationStream(target, qc, {});
    const es = FakeEventSource.instances.at(-1) as FakeEventSource;
    es.fireOpen();
    const event = { type: 'message', message: delivered, deliveredQueue: { conversationId: CONV, messageId: 'source-queued' } };
    es.push(event);
    es.push(event);
    expect(qc.getQueryData(['messages', CONV, 'pages'])).toMatchObject({ pages: [{ queuedMessages: [keep] }] });
    expect(qc.getQueryData(['messages', target, 'pages'])).toMatchObject({ pages: [{ messages: [delivered] }] });
    stop();
    qc.clear();
  });

  it('keeps queued messages out of the delivered transcript and updates the capsule once', () => {
    const qc = freshClient();
    const envelope = { messages: [], chips: null, historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null };
    qc.setQueryData(['messages', CONV, 'pages'], { pages: [envelope], pageParams: [null] });
    const es = startStream(qc);
    const message = { id: 'queued-1', role: 'user', content: 'Wait for the current turn', createdAt: 3, deliverAfterStop: false };
    es.push({ type: 'message', message });
    es.push({ type: 'message', message });
    expect(qc.getQueryData(['messages', CONV, 'pages'])).toEqual({
      pages: [{ ...envelope, queuedMessages: [{ id: message.id, content: message.content, createdAt: 3 }] }],
      pageParams: [null],
    });
    qc.clear();
  });

  it('does not let a pre-confirmation read erase a received message', async () => {
    const qc = freshClient();
    const key = ['messages', CONV, 'pages'];
    const envelope = { messages: [], chips: null, historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null };
    const initial = { pages: [envelope], pageParams: [null] };
    qc.setQueryData(key, initial);
    let finish = (_value: typeof initial) => {};
    const read = qc.fetchQuery({ queryKey: key, queryFn: () => new Promise<typeof initial>((resolve) => { finish = resolve; }) }).catch(() => undefined);
    const es = startStream(qc);
    const message = { id: 'new-user', role: 'user', content: 'Keep my confirmation', createdAt: 3 };
    es.push({ type: 'message', message });
    finish(initial);
    await read;
    expect(qc.getQueryData(key)).toEqual({ pages: [{ ...envelope, messages: [message] }], pageParams: [null] });
    qc.clear();
  });

  it.each(['chief-t-740', 'build-740'])('shows %s events before a transcript read and deduplicates replay', (id) => {
    const qc = freshClient();
    const message = { id: 'user-740', role: 'user', content: 'Show this now', createdAt: 3 };
    const envelope = { messages: [], chips: null, historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null };
    const older = { ...envelope, messages: [{ ...message, id: 'older', createdAt: 1 }] };
    qc.setQueryData(['messages', id, 'pages'], {
      pages: [{ ...envelope, nextCursor: 'older' }, older],
      pageParams: [null, 'older'],
    });
    const stop = startConversationStream(id, qc, {});
    const es = FakeEventSource.instances.at(-1) as FakeEventSource;
    es.fireOpen();
    es.push({ type: 'message', message });
    es.push({ type: 'message', message });
    expect(qc.getQueryData(['messages', id, 'pages'])).toEqual({
      pages: [{ ...envelope, messages: [message], nextCursor: 'older' }, older],
      pageParams: [null, 'older'],
    });
    stop();
    qc.clear();
  });
});

describe('clear on entry: a replay is a snapshot (failure mode 1)', () => {
  it('stale buffer from before the subscription is cleared before the first event can arrive', () => {

    liveTextStore.append(CONV, '旧缓冲');
    const qc = freshClient();
    FakeEventSource.instances = [];
    startConversationStream(CONV, qc, {});

    expect(liveTextStore.get(CONV)).toBe('');
    const es = FakeEventSource.instances[0] as FakeEventSource;
    es.fireOpen();
    es.push({ type: 'text_delta', text: '补发前缀' });
    expect(liveTextStore.get(CONV)).toBe('补发前缀');
  });
});

describe('reconnect: rebuild clears (failure mode 2)', () => {
  it('after a watchdog rebuild the stale buffer is void, a replayed snapshot does not stack a double copy', () => {
    const qc = freshClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const es = startStream(qc);
    es.push({ type: 'text_delta', text: '断线前' });
    expect(liveTextStore.get(CONV)).toBe('断线前');

    vi.advanceTimersByTime(20_000);
    const rebuilt = FakeEventSource.instances[1] as FakeEventSource;
    expect(rebuilt).toBeDefined();
    rebuilt.fireOpen();

    expect(liveTextStore.get(CONV)).toBe('');
    expect(invalidate).toHaveBeenCalled();

    rebuilt.push({ type: 'text_delta', text: '断线前后缀' });
    expect(liveTextStore.get(CONV)).toBe('断线前后缀');
  });
});

describe('seam: replayed snapshot + live increments (failure mode 3)', () => {
  it('one replay and the following increments splice exactly — no overlap, no break', () => {
    const qc = freshClient();
    const es = startStream(qc);
    es.push({ type: 'text_delta', text: '前缀' });
    es.push({ type: 'text_delta', text: '增量' });
    expect(liveTextStore.get(CONV)).toBe('前缀增量');
  });
});

describe('existing faces unchanged (failure mode 4; #857 settle-handoff rewrote the clear semantics)', () => {
  it.each(['done', 'failed', 'stopped'])(
    'reads a missing Coordinator response after the step is %s',
    async (status) => {
      const qc = freshClient();
      const key = ['messages', CONV, 'pages'];
      const question = { id: 'question', role: 'user', content: 'Who are you?', createdAt: 1 };
      const answer = { id: 'answer', role: 'assistant', content: 'Coordinator', createdAt: 2 };
      let settled = false;
      const options = {
        queryKey: key,
        staleTime: Infinity,
        queryFn: async () => ({
          pages: [{ messages: settled ? [question, answer] : [question] }],
          pageParams: [null],
        }),
      };
      await qc.fetchQuery(options);
      const observer = new QueryObserver(qc, options);
      const unsubscribe = observer.subscribe(() => {});
      const stop = startConversationStream(CONV, qc, {});
      const es = FakeEventSource.instances.at(-1)!;
      es.fireOpen();
      settled = true;
      es.push({ type: 'step', step: { id: 's1', status } });
      await vi.advanceTimersByTimeAsync(0);
      expect(qc.getQueryData(key)).toEqual({
        pages: [{ messages: [question, answer] }],
        pageParams: [null],
      });
      stop();
      unsubscribe();
      qc.clear();
    },
  );

  it.each([true, false])('recovers a Coordinator response and retires typing when cached running is %s', async (cachedRunning) => {
    const qc = freshClient();
    const key = ['messages', CONV, 'pages'];
    const question = { id: 'question', role: 'user', content: 'Who are you?', createdAt: 1 };
    const answer = { id: 'answer', role: 'assistant', content: 'Coordinator', createdAt: 2 };
    let settled = false;
    qc.setQueryData(['chiefThreads', 'team-1'], [{ id: CONV, activeRun: cachedRunning ? { phase: 'chief' } : null }]);
    const options = {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => ({
        pages: [{
          messages: settled ? [question, answer] : [question],
          activeRun: settled || !cachedRunning ? null : { phase: 'chief' },
        }],
        pageParams: [null],
      }),
    };
    await qc.fetchQuery(options);
    const observer = new QueryObserver(qc, options);
    const unsubscribe = observer.subscribe(() => {});
    const stop = startConversationStream(CONV, qc, {});
    const es = FakeEventSource.instances.at(-1)!;
    es.fireOpen();
    es.push({ type: 'text_delta', text: answer.content });
    es.push({ type: 'thinking_delta', text: 'Finished thinking' });
    settled = true;
    for (let i = 0; i < 4; i++) {
      if (i === 1)
        qc.setQueryData(['chiefThreads', 'team-1'], [{ id: CONV, activeRun: null }]);
      es.push({ type: 'ping' });
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(qc.getQueryData(key)).toEqual({
      pages: [{ messages: [question, answer], activeRun: null }],
      pageParams: [null],
    });
    expect(liveTextStore.get(CONV)).toBe('');
    expect(liveThinkingStore.get(CONV)).toBe('');
    expect(FakeEventSource.instances).toHaveLength(1);
    stop();
    unsubscribe();
    qc.clear();
  });

  it.each(['running', 'new-event', 'unsubscribed', 'failed-read'] as const)(
    'preserves streamed text when reconciliation is %s',
    async (scenario) => {
      const qc = freshClient();
      const key = ['messages', CONV, 'pages'];
      const initial = { pages: [{ messages: [], activeRun: { phase: 'chief' } as { phase: string } | null }], pageParams: [null] };
      let finish: ((value: typeof initial) => void) | undefined;
      let fail: ((reason: Error) => void) | undefined;
      let reads = 0;
      const options = {
        queryKey: key,
        staleTime: Infinity,
        queryFn: () => ++reads === 1 ? Promise.resolve(initial) : new Promise<typeof initial>((resolve, reject) => { finish = resolve; fail = reject; }),
      };
      await qc.fetchQuery(options);
      const observer = new QueryObserver(qc, options);
      const unsubscribe = observer.subscribe(() => {});
      const stop = startConversationStream(CONV, qc, {});
      const es = FakeEventSource.instances.at(-1)!;
      es.fireOpen();
      es.push({ type: 'text_delta', text: 'Do not erase this' });
      for (let i = 0; i < 4; i++) {
        es.push({ type: 'ping' });
        await vi.advanceTimersByTimeAsync(5_000);
      }
      expect(reads).toBe(2);
      if (scenario === 'new-event') es.push({ type: 'text_delta', text: ' next turn' });
      if (scenario === 'unsubscribed') stop();
      if (scenario === 'failed-read') fail?.(new Error('Read unavailable'));
      else finish?.({ pages: [{ messages: [], activeRun: scenario === 'running' ? { phase: 'chief' } : null }], pageParams: [null] });
      await vi.advanceTimersByTimeAsync(0);
      expect(liveTextStore.get(CONV)).toBe(`Do not erase this${scenario === 'new-event' ? ' next turn' : ''}`);
      stop();
      unsubscribe();
      qc.clear();
    },
  );

  it('message event (assistant text row): records handoff, does not clear the buffer + messages/plans invalidated and refetched', () => {
    const qc = freshClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const es = startStream(qc);
    es.push({ type: 'text_delta', text: '段' });
    es.push({
      type: 'message',
      message: { id: 'm1', role: 'assistant', content: '终稿', createdAt: 1 },
    });

    expect(liveTextStore.get(CONV)).toBe('段');

    expect(liveTextStore.getVisible(CONV, new Set())).toBe('段');
    expect(liveTextStore.getVisible(CONV, new Set(['m1']))).toBe('');
    const keys = invalidate.mock.calls.map(([filters]) => filters as { queryKey?: string[] });
    expect(keys.some((f) => f.queryKey?.[0] === 'messages')).toBe(true);
    expect(keys.some((f) => f.queryKey?.[0] === 'plans')).toBe(true);
  });

  it('a Coordinator message refreshes the Tasks read, where its questions are listed', () => {
    const qc = freshClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const es = startStream(qc);
    es.push({
      type: 'message',
      message: { id: 'm-q', role: 'assistant', content: 'question', createdAt: 1 },
    });

    const keys = invalidate.mock.calls.map(([filters]) => filters as { queryKey?: string[] });
    expect(keys.some((f) => f.queryKey?.[0] === 'tasks')).toBe(true);
  });

  it('message event (tool row): does not record handoff, buffer kept', () => {
    const qc = freshClient();
    const es = startStream(qc);
    es.push({ type: 'text_delta', text: '段' });
    es.push({
      type: 'message',
      message: {
        id: 'm-tool',
        role: 'assistant',
        content: { kind: 'toolcall', call: { id: 'c1', name: 'todo_write', arguments: {} } },
        createdAt: 1,
      },
    });

    expect(liveTextStore.get(CONV)).toBe('段');
    expect(liveTextStore.getVisible(CONV, new Set(['m-tool']))).toBe('段');
  });

  it('a claim refreshes a cached pending page before streamed resumed text arrives', async () => {
    const qc = freshClient();
    const key = ['messages', CONV, 'pages'];
    const wake = { id: 'user-wake', role: 'user', content: '[wake:failed]', createdAt: 1 };
    const boundary = { id: 'user-resumed', role: 'system', content: '', createdAt: 2 };
    let claimed = false;
    const options = {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => ({ messages: claimed ? [wake, boundary] : [wake] }),
    };
    await qc.fetchQuery(options);
    const observer = new QueryObserver(qc, options);
    const unsubscribe = observer.subscribe(() => {});
    const es = startStream(qc);
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(key)).toEqual({ messages: [wake] });
    claimed = true;
    es.push({ type: 'step', step: { id: 'resumed', buildId: CONV, kind: 'chief', machineId: null, createdAt: 2, status: 'claimed' } });
    es.push({ type: 'text_delta', text: 'Reading your answer.' });
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(key)).toEqual({ messages: [wake, boundary] });
    expect(liveTextStore.get(CONV)).toBe('Reading your answer.');
    unsubscribe();
    qc.clear();
  });

  it('step event: invalidates and refetches, buffer untouched', () => {
    const qc = freshClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const es = startStream(qc);
    es.push({ type: 'text_delta', text: '段' });
    es.push({
      type: 'step',
      step: { id: 's1', buildId: CONV, kind: 'chief', machineId: null, createdAt: 1, status: 'claimed' },
    });
    expect(liveTextStore.get(CONV)).toBe('段');
    expect(invalidate).toHaveBeenCalled();
  });

  it('handlers pass through: onMessage/onStep receive payloads as usual', () => {
    const qc = freshClient();
    const onMessage = vi.fn();
    const onStep = vi.fn();
    FakeEventSource.instances = [];
    startConversationStream(CONV, qc, { onMessage, onStep });
    const es = FakeEventSource.instances[0] as FakeEventSource;
    es.fireOpen();
    es.push({
      type: 'message',
      message: { id: 'm1', role: 'assistant', content: '终稿', createdAt: 1 },
    });
    es.push({
      type: 'step',
      step: { id: 's1', buildId: CONV, kind: 'chief', machineId: null, createdAt: 1, status: 'done' },
    });
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1', role: 'assistant' }),
    );
    expect(onStep).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', status: 'done' }));
  });
});

describe('activity phase single slot (#905)', () => {
  it('activity events enter the slot; later overrides earlier (single-slot semantics)', () => {
    const es = startStream(freshClient());
    es.push({
      type: 'activity',
      activity: { stepId: 's1', phase: 'thinking', at: 100 },
    });
    expect(activityStore.get(CONV)).toEqual({ stepId: 's1', phase: 'thinking', at: 100 });
    es.push({
      type: 'activity',
      activity: { stepId: 's1', phase: 'tool', tool: 'bash', at: 200 },
    });
    expect(activityStore.get(CONV)).toEqual({
      stepId: 's1',
      phase: 'tool',
      tool: 'bash',
      at: 200,
    });
  });

  it('step final state (done/failed/stopped) clears the slot; claimed does not', () => {
    for (const status of ['done', 'failed', 'stopped'] as const) {
      activityStore.clear(CONV);
      const es = startStream(freshClient());
      es.push({ type: 'activity', activity: { stepId: 's1', phase: 'thinking', at: 100 } });
      es.push({
        type: 'step',
        step: { id: 's1', buildId: CONV, kind: 'plan', machineId: null, createdAt: 1, status },
      });
      expect(activityStore.get(CONV)).toBeNull();
    }
    activityStore.clear(CONV);
    const es = startStream(freshClient());
    es.push({ type: 'activity', activity: { stepId: 's1', phase: 'thinking', at: 100 } });
    es.push({
      type: 'step',
      step: { id: 's1', buildId: CONV, kind: 'plan', machineId: null, createdAt: 1, status: 'claimed' },
    });
    expect(activityStore.get(CONV)).not.toBeNull();
  });

  it('stream rebuild clears the slot: the new subscription voids the old phase first, the hub replay takes over', () => {
    activityStore.set(CONV, { stepId: 's0', phase: 'thinking', at: 50 });
    const qc = freshClient();
    FakeEventSource.instances = [];
    startConversationStream(CONV, qc, {});
    expect(activityStore.get(CONV)).toBeNull();

    const es = FakeEventSource.instances[0] as FakeEventSource;
    es.fireOpen();
    es.push({ type: 'activity', activity: { stepId: 's1', phase: 'tool', tool: 'read', at: 300 } });
    expect(activityStore.get(CONV)).toMatchObject({ phase: 'tool', tool: 'read' });
  });
});

describe('thinking increments (#1308)', () => {
  const thinkingRow = {
    id: 'm-think',
    role: 'assistant' as const,
    content: [{ type: 'thinking', thinking: 'REASONING-MARKER-1308' }],
    createdAt: 1,
  };

  it('thinking_delta enters only the thinking buffer, not the body buffer', () => {
    const es = startStream(freshClient());
    es.push({ type: 'thinking_delta', text: 'REASONING-MARKER-1308' });
    expect(liveThinkingStore.get(CONV)).toBe('REASONING-MARKER-1308');
    expect(liveTextStore.get(CONV)).toBe('');
  });

  it('text_delta does not enter the thinking buffer', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: 'answer' });
    expect(liveTextStore.get(CONV)).toBe('answer');
    expect(liveThinkingStore.get(CONV)).toBe('');
  });

  it('stale thinking buffer from before the subscription is cleared before the replay', () => {
    liveThinkingStore.append(CONV, '旧思考');
    FakeEventSource.instances = [];
    startConversationStream(CONV, freshClient(), {});
    expect(liveThinkingStore.get(CONV)).toBe('');
    const es = FakeEventSource.instances[0] as FakeEventSource;
    es.fireOpen();
    es.push({ type: 'thinking_delta', text: '补发思考' });
    expect(liveThinkingStore.get(CONV)).toBe('补发思考');
  });

  it('activity resetLive clears the in-flight thinking (fallback round)', () => {
    const es = startStream(freshClient());
    es.push({ type: 'thinking_delta', text: '旧轮思考' });
    expect(liveThinkingStore.get(CONV)).toBe('旧轮思考');

    es.push({
      type: 'activity',
      activity: { stepId: 's1', phase: 'starting', at: 1 },
    });
    expect(liveThinkingStore.get(CONV)).toBe('旧轮思考');
    es.push({
      type: 'activity',
      activity: { stepId: 's1', phase: 'starting', at: 2, resetLive: true },
    });
    expect(liveThinkingStore.get(CONV)).toBe('');
  });

  it('reconnect resync voids the old thinking buffer, a replayed snapshot does not stack', () => {
    const es = startStream(freshClient());
    es.push({ type: 'thinking_delta', text: '断线前' });
    vi.advanceTimersByTime(20_000);
    const rebuilt = FakeEventSource.instances[1] as FakeEventSource;
    rebuilt.fireOpen();
    expect(liveThinkingStore.get(CONV)).toBe('');
    rebuilt.push({ type: 'thinking_delta', text: '断线前后缀' });
    expect(liveThinkingStore.get(CONV)).toBe('断线前后缀');
  });

  it('thinking segment rows record the handoff: once the row is in messages the visible buffer is empty', () => {
    const es = startStream(freshClient());
    es.push({ type: 'thinking_delta', text: 'REASONING-MARKER-1308' });
    es.push({ type: 'message', message: thinkingRow });
    expect(liveThinkingStore.get(CONV)).toBe('REASONING-MARKER-1308');
    expect(liveThinkingStore.getVisible(CONV, new Set())).toBe('REASONING-MARKER-1308');
    expect(liveThinkingStore.getVisible(CONV, new Set(['m-think']))).toBe('');
    expect(liveTextStore.get(CONV)).toBe('');
  });

  it('body rows do not record the thinking handoff', () => {
    const es = startStream(freshClient());
    es.push({ type: 'thinking_delta', text: '仍在飞' });
    es.push({
      type: 'message',
      message: { id: 'm-text', role: 'assistant', content: '终稿', createdAt: 2 },
    });
    expect(liveThinkingStore.getVisible(CONV, new Set(['m-text']))).toBe('仍在飞');
  });

  it('step final state clears the thinking buffer; claimed does not', () => {
    const es = startStream(freshClient());
    es.push({ type: 'thinking_delta', text: '段' });
    es.push({
      type: 'step',
      step: { id: 's1', buildId: CONV, kind: 'plan', machineId: null, createdAt: 1, status: 'claimed' },
    });
    expect(liveThinkingStore.get(CONV)).toBe('段');
    es.push({
      type: 'step',
      step: { id: 's1', buildId: CONV, kind: 'plan', machineId: null, createdAt: 1, status: 'done' },
    });
    expect(liveThinkingStore.get(CONV)).toBe('');
  });
});

describe('agent todo list single slot (#1524)', () => {
  const todoEvent = (items: { text: string; state: 'todo' | 'doing' | 'done' }[]) => ({
    type: 'agent_todo' as const,
    todo: { stepId: 's1', at: 100, items },
  });

  it('agent_todo events enter the slot; later overrides earlier (whole-table replacement)', () => {
    const es = startStream(freshClient());
    es.push(todoEvent([{ text: '第一条', state: 'todo' }]));
    expect(agentTodoStore.get(CONV)).toMatchObject({
      stepId: 's1',
      items: [{ text: '第一条', state: 'todo' }],
    });
    es.push(todoEvent([{ text: '第二条', state: 'doing' }]));
    expect(agentTodoStore.get(CONV)).toMatchObject({
      stepId: 's1',
      items: [{ text: '第二条', state: 'doing' }],
    });
  });

  it('step final state (done/failed/stopped) clears the slot; claimed does not', () => {
    for (const status of ['done', 'failed', 'stopped'] as const) {
      agentTodoStore.clear(CONV);
      const es = startStream(freshClient());
      es.push(todoEvent([{ text: '条目', state: 'todo' }]));
      es.push({
        type: 'step',
        step: { id: 's1', buildId: CONV, kind: 'plan', machineId: null, createdAt: 1, status },
      });
      expect(agentTodoStore.get(CONV)).toBeNull();
    }
    agentTodoStore.clear(CONV);
    const es = startStream(freshClient());
    es.push(todoEvent([{ text: '条目', state: 'todo' }]));
    es.push({
      type: 'step',
      step: { id: 's1', buildId: CONV, kind: 'plan', machineId: null, createdAt: 1, status: 'claimed' },
    });
    expect(agentTodoStore.get(CONV)).not.toBeNull();
  });

  it('stream rebuild clears the slot: the new subscription voids the old list first, the hub replay takes over', () => {
    agentTodoStore.set(CONV, { stepId: 's0', at: 50, items: [{ text: '旧', state: 'todo' }] });
    FakeEventSource.instances = [];
    startConversationStream(CONV, freshClient(), {});
    expect(agentTodoStore.get(CONV)).toBeNull();
    const es = FakeEventSource.instances[0] as FakeEventSource;
    es.fireOpen();
    es.push(todoEvent([{ text: '补发', state: 'doing' }]));
    expect(agentTodoStore.get(CONV)).toMatchObject({ items: [{ text: '补发', state: 'doing' }] });
  });
});
