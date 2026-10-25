import { QueryClient } from '@tanstack/react-query';
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
