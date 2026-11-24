import type { ChiefGetResponse, ChiefThread } from '@cairn/shared';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { liveTextStore } from '../src/api/live-text.js';
import { mapChief, type MessageRow } from '../src/api/mappers.js';
import { type ConvHandle, FakeEventSource, startConv, stopAllTabStreams, stubTabFollow } from './tab-stream-harness.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

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

function visibleTailText(messages: MessageRow[], liveText: string, thread = THREAD): string {
  const chief = mapChief(ENV, { threads: [thread], activeThreadId: CONV, messages, liveText });
  return (chief.stream ?? [])
    .filter((i): i is Extract<ChiefStreamItem, { kind: 'robot' }> => i.kind === 'robot')
    .map((i) => i.markdown ?? '')
    .join('\n');
}

function visible(messages: MessageRow[], thread = THREAD): string {
  const knownIds = new Set(messages.map((m) => m.id));
  return visibleTailText(messages, liveTextStore.getVisible(CONV, knownIds), thread);
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  stubTabFollow();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(cb, 16));
  liveTextStore.clear(CONV);
});

afterEach(() => {
  stopAllTabStreams();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  liveTextStore.clear(CONV);
});

function startStream(qc: QueryClient): ConvHandle {
  FakeEventSource.instances = [];
  const es = startConv(CONV, qc);
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

  test('F-H7 a final step event right after the final text row keeps the streamed text until the stored row is known', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: '最终结论' });
    es.push({ type: 'message', message: textRow('m1', '最终结论') });
    es.push(stepEvent('done'));

    expect(visible([USER])).toContain('最终结论');

    const knownIds = new Set([USER.id, 'm1']);
    expect(liveTextStore.getVisible(CONV, knownIds)).toBe('');
    liveTextStore.prune(CONV, knownIds);
    expect(liveTextStore.get(CONV)).toBe('');
  });

  test.each(['done', 'stopped', 'failed'])(
    'F-H10 a %s turn keeps the streamed reply after the thread stops running until the stored row loads',
    (status) => {
      const es = startStream(freshClient());
      es.push({ type: 'text_delta', text: '最终结论' });
      es.push({ type: 'message', message: textRow('m1', '最终结论') });
      es.push(stepEvent(status));
      const finished = { ...THREAD, activeRun: null };

      expect(visible([USER], finished)).toBe('最终结论');

      const settled = [USER, textRow('m1', '最终结论')];
      expect(visible(settled, finished).split('最终结论')).toHaveLength(2);
    },
  );

  test('F-H9 a terminal step drops text streamed after the pending handoff and keeps the settled prefix', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: '第一段' });
    es.push({ type: 'message', message: textRow('m1', '第一段') });
    es.push({ type: 'text_delta', text: '未落库的后半' });
    es.push(stepEvent('failed'));

    expect(visible([USER])).toContain('第一段');
    expect(liveTextStore.get(CONV)).toBe('第一段');

    const knownIds = new Set([USER.id, 'm1']);
    liveTextStore.prune(CONV, knownIds);
    expect(liveTextStore.get(CONV)).toBe('');
  });

  test('F-H8 a failed or stopped step refetches the Coordinator record so the outage banner appears', () => {
    const qc = freshClient();
    const teamKey = ['chief', 'team-1', null];
    const threadKey = ['chief', 'team-1', CONV];
    const unrelated = ['session'];
    qc.setQueryData(teamKey, {});
    qc.setQueryData(threadKey, {});
    qc.setQueryData(unrelated, {});
    const es = startStream(qc);
    es.push(stepEvent('failed'));

    expect(qc.getQueryState(teamKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(threadKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });

  test('F-H6 same-turn listener replacement keeps the preview until a fresh hello', async () => {
    const qc = freshClient();
    const es = startStream(qc);
    es.push({ type: 'text_delta', text: '段' });
    es.push({ type: 'message', message: textRow('m1', '段') });
    await vi.advanceTimersByTimeAsync(0);
    es.stop();
    const replacement = startConv(CONV, qc);
    expect(liveTextStore.get(CONV)).toBe('段');
    expect(FakeEventSource.instances).toHaveLength(1);

    FakeEventSource.instances[0]?.onerror?.();
    replacement.fireOpen();
    expect(liveTextStore.get(CONV)).toBe('');
  });

  test('a settled reply whose turn created tasks shows no working dots while the run winds down', () => {
    const create: MessageRow = {
      id: 'create',
      role: 'assistant',
      content: {
        kind: 'toolcall',
        call: {
          id: 'c-create',
          name: 'create_todo',
          arguments: { title: 'Fix counts', projectId: 'p1' },
          result: { id: 'todo-1', seqNum: 9, title: 'Fix counts' },
          startedAt: NOW,
          endedAt: NOW + 1,
        },
      },
      createdAt: NOW,
    };
    const chief = mapChief(ENV, {
      threads: [THREAD],
      activeThreadId: CONV,
      messages: [USER, create, textRow('answer', 'Started it.')],
    });
    const kinds = (chief.stream ?? []).map((item: ChiefStreamItem) => item.kind);
    expect(kinds).toEqual(['user', 'robot', 'task-card']);
  });
});

