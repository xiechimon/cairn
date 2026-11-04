import type { ChiefGetResponse, ChiefThread } from '@cairn/shared';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { liveTextStore } from '../src/api/live-text.js';
import { mapChief, type MessageRow } from '../src/api/mappers.js';
import { startConversationStream } from '../src/api/sse.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

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

const CONV = 'chief-t-857';
const NOW = 1_758_000_000_000;

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function toolRow(id: string): MessageRow {
  return {
    id,
    role: 'assistant',
    content: {
      kind: 'toolcall',
      call: { id: `c-${id}`, name: 'todo_write', arguments: {}, startedAt: NOW, endedAt: NOW + 1 },
    },
    createdAt: NOW,
  };
}

function textRow(id: string, text: string): MessageRow {
  return { id, role: 'assistant', content: text, createdAt: NOW };
}

function stepEvent(status: string) {
  return {
    type: 'step',
    step: { id: 's1', buildId: CONV, kind: 'chief', machineId: null, createdAt: NOW, status },
  };
}

const ENV = {
  chief: {
    id: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    agent: { agentId: 'agent-1' },
    charter: null,
    lastTurnAt: null,
    createdAt: 0,
    tz: null,
    model: null,
  },
  agentActor: null,
  context: null,
  watches: [],
  wakes: [],
} as unknown as ChiefGetResponse;

const THREAD: ChiefThread = {
  id: CONV,
  chiefId: 'chief-u1-t1',
  userId: 'u1',
  teamId: 't1',
  title: '线程',
  createdAt: 2,
  updatedAt: 2,
  lastTurnAt: null,
  session: { runtime: 'pi', id: 's2', openedAt: 2 },
  pendingSessionResumeAt: null,
  toolDefHashes: {},
  toolResultHashes: {},
  activeRun: { phase: 'chief' },
};

const USER: MessageRow = {
  id: 'AbCdEfGhIjKlMnOpQrStU',
  role: 'user',
  content: '查一下失败原因',
  createdAt: NOW - 1000,
};

function visibleTailText(messages: MessageRow[], liveText: string): string {
  const chief = mapChief(
    ENV,
    { threads: [THREAD], activeThreadId: CONV, messages, liveText },
  );
  return (chief.stream ?? [])
    .filter((i): i is Extract<ChiefStreamItem, { kind: 'robot' }> => i.kind === 'robot')
    .map((i) => i.markdown ?? '')
    .join('\n');
}

function visible(messages: MessageRow[]): string {
  const knownIds = new Set(messages.map((m) => m.id));
  return visibleTailText(messages, liveTextStore.getVisible(CONV, knownIds));
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  liveTextStore.clear(CONV);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  liveTextStore.clear(CONV);
});

function startStream(qc: QueryClient): FakeEventSource {
  FakeEventSource.instances = [];
  startConversationStream(CONV, qc, {});
  const es = FakeEventSource.instances[0] as FakeEventSource;
  es.fireOpen();
  return es;
}

describe('chief streaming handoff (#857 F-H1..H6)', () => {
  test('F-H1 tool-row events do not clear the buffer', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: '先看任务现状' });
    es.push({ type: 'message', message: toolRow('m-tool-1') });
    expect(liveTextStore.get(CONV)).toBe('先看任务现状');
  });

  test('F-H2 text-row events only record the handoff, buffer kept', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: '第一轮结论' });
    es.push({ type: 'message', message: textRow('m1', '第一轮结论') });

    expect(liveTextStore.get(CONV)).toBe('第一轮结论');
  });

  test('F-H3 after tool events the visible tail text is monotonic (re-fetch in-flight does not flash-clear)', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: '先看任务现状' });
    es.push({ type: 'message', message: toolRow('m-tool-1') });

    expect(visible([USER])).toContain('先看任务现状');
  });

  test('F-H4 settle is handoff: stored rows take over, typing face retires, no duplicate, no flash', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: '第一轮结论' });
    es.push({ type: 'message', message: textRow('m1', '第一轮结论') });

    expect(visible([USER])).toContain('第一轮结论');

    const tail = visible([USER, textRow('m1', '第一轮结论')]);
    expect(tail).toContain('第一轮结论');

    expect(tail.split('第一轮结论')).toHaveLength(2);
  });

  test('F-H5 step final state clears the buffer', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: '残段' });
    es.push(stepEvent('done'));
    expect(liveTextStore.get(CONV)).toBe('');
  });

  test('F-H6 resubscribe still clears first (#740 unchanged)', () => {
    const qc = freshClient();
    const es = startStream(qc);
    es.push({ type: 'text_delta', text: '段' });
    es.push({ type: 'message', message: textRow('m1', '段') });

    FakeEventSource.instances = [];
    startConversationStream(CONV, qc, {});
    expect(liveTextStore.get(CONV)).toBe('');
  });
});
