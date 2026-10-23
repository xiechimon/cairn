// #857 chief 抽屉流式闪清：message 事件同步清 liveTextStore，而 messages
// 重取是异步的——每轮文本在落库行可见前凭空消失，直到重取落地才重现。
// 失败方式先行枚举：
//   F-H1 工具行事件（toolcall 落库）不清缓冲：段文本尚无落库行覆盖，清即丢显示
//   F-H2 文本行事件不清缓冲、只记 handoff：收敛（messages 含该行）前打字面保留
//   F-H3 可见尾文本单调：工具/文本事件后（重取在飞）尾行仍含已流出文本，不闪清
//   F-H4 收敛即交接：messages 含 handoff 行后打字面退场，落库行接管，不重不闪
//   F-H5 步终态清缓冲：done/failed/stopped 兜底（hub 同律），防 stale 跨回合累积
//   F-H6 重订阅/重连仍先清：#740 语义不变，补发快照不叠双份

import type { ChiefGetResponse, ChiefThread } from '@cairn/shared';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { liveTextStore } from '../src/api/live-text.js';
import { mapChief, type MessageRow } from '../src/api/mappers.js';
import { startConversationStream } from '../src/api/sse.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

/** 替身 EventSource：sse-conversation-stream.test.ts 同款。 */
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

// —— mapChief 最小支架（chief-flight-expand.test.ts 同形） ——

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

/** 可见尾文本：落库 robot 行 + typing 行的文本拼接（用户所见即此）。 */
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

/** 消费侧读法：visible = 收敛感知（与 use-chief-surface 同源）。 */
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

describe('chief 流式 handoff（#857 F-H1..H6）', () => {
  test('F-H1 工具行事件不清缓冲', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: '先看任务现状' });
    es.push({ type: 'message', message: toolRow('m-tool-1') });
    expect(liveTextStore.get(CONV)).toBe('先看任务现状');
  });

  test('F-H2 文本行事件只记 handoff、不清缓冲', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: '第一轮结论' });
    es.push({ type: 'message', message: textRow('m1', '第一轮结论') });
    // 重取在飞（messages 仍是旧快照）：缓冲保留。
    expect(liveTextStore.get(CONV)).toBe('第一轮结论');
  });

  test('F-H3 工具事件后可见尾文本单调（重取在飞不闪清）', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: '先看任务现状' });
    es.push({ type: 'message', message: toolRow('m-tool-1') });
    // messages 重取尚未落地：仍是 [USER]。
    expect(visible([USER])).toContain('先看任务现状');
  });

  test('F-H4 收敛即交接：落库行接管，打字面退场，不重不闪', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: '第一轮结论' });
    es.push({ type: 'message', message: textRow('m1', '第一轮结论') });
    // 收敛前（重取在飞）：打字面保留，不闪清。
    expect(visible([USER])).toContain('第一轮结论');
    // 重取落地：messages 含 m1，打字面退场，落库行接管。
    const tail = visible([USER, textRow('m1', '第一轮结论')]);
    expect(tail).toContain('第一轮结论');
    // 恰出现一次（无双份）。
    expect(tail.split('第一轮结论')).toHaveLength(2);
  });

  test('F-H5 步终态清缓冲', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: '残段' });
    es.push(stepEvent('done'));
    expect(liveTextStore.get(CONV)).toBe('');
  });

  test('F-H6 重订阅仍先清（#740 不变）', () => {
    const qc = freshClient();
    const es = startStream(qc);
    es.push({ type: 'text_delta', text: '段' });
    es.push({ type: 'message', message: textRow('m1', '段') });
    // 重建订阅：旧缓冲（含未收敛 handoff）作废，服务端补发快照接管。
    FakeEventSource.instances = [];
    startConversationStream(CONV, qc, {});
    expect(liveTextStore.get(CONV)).toBe('');
  });
});
