// #740 conversation stream 订阅重置语义（客户端半）：流（重）建立时先清
// liveTextStore 再消费事件——服务端 subscribe 补发是「当前段快照」，客户端
// 旧缓冲（断线前 / 关抽屉前累积的）必须先作废，否则补发叠加成双份。
// 失败方式清单（票面 ① 的客户端半 + 既有面保持）：
// 1. 双份文本：进场前残留的旧缓冲未清 → 补发后 = 旧 + 补发（双份）。
// 2. 断线重连：重建流时旧缓冲未清 → 补发 + 断线前文本叠加（双份）。
// 3. 接缝：补发（快照）与后续 live 增量必须精确拼接——不重不断。
// 4. 既有面保持：assistant 文本行事件记 handoff 不清缓冲（#857；工具行不记）
//    + 失效重取；step 终态清缓冲；重连 resync 仍全量失效重取（#462）。
// 服务端半（hub 缓冲/补发/清空点）见 apps/server/test/conv-stream-catchup.test.ts。

import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activityStore } from '../src/api/activity.js';
import { liveTextStore } from '../src/api/live-text.js';
import { liveThinkingStore } from '../src/api/live-thinking.js';
import { startConversationStream } from '../src/api/sse.js';

/** 替身 EventSource：sse-connection.test.ts 同款（静态 OPEN 量必须留着）。 */
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

/** 起流（清零instances 后），返回当前连接替身。 */
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  liveTextStore.clear(CONV);
  liveThinkingStore.clear(CONV);
  activityStore.clear(CONV);
});

describe('进场先清：补发即快照（失败方式 1）', () => {
  it('订阅前残留的旧缓冲在首事件可能到达前已被清空', () => {
    // 关抽屉 / 上一次订阅留下的残段。
    liveTextStore.append(CONV, '旧缓冲');
    const qc = freshClient();
    FakeEventSource.instances = [];
    startConversationStream(CONV, qc, {});
    // 清点在 connect 之前：任何事件（含补发）都还没可能被消费。
    expect(liveTextStore.get(CONV)).toBe('');
    const es = FakeEventSource.instances[0] as FakeEventSource;
    es.fireOpen();
    es.push({ type: 'text_delta', text: '补发前缀' });
    expect(liveTextStore.get(CONV)).toBe('补发前缀');
  });
});

describe('断线重连：重建即清（失败方式 2）', () => {
  it('看门狗重建后旧缓冲作废，补发快照不叠加双份', () => {
    const qc = freshClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const es = startStream(qc);
    es.push({ type: 'text_delta', text: '断线前' });
    expect(liveTextStore.get(CONV)).toBe('断线前');

    // 完全静默 20s → 看门狗重建连接（#462 同路径：open() → onopen → resync）。
    vi.advanceTimersByTime(20_000);
    const rebuilt = FakeEventSource.instances[1] as FakeEventSource;
    expect(rebuilt).toBeDefined();
    rebuilt.fireOpen();
    // resync：清缓冲（旧段作废）+ 全量失效重取（既有 #462 面保持）。
    expect(liveTextStore.get(CONV)).toBe('');
    expect(invalidate).toHaveBeenCalled();

    // 服务端在新订阅上补发当前段快照（含断线窗口内流掉的增量）。
    rebuilt.push({ type: 'text_delta', text: '断线前后缀' });
    expect(liveTextStore.get(CONV)).toBe('断线前后缀');
  });
});

describe('接缝：补发快照 + live 增量（失败方式 3）', () => {
  it('一条补发与后续增量精确拼接——不重不断', () => {
    const qc = freshClient();
    const es = startStream(qc);
    es.push({ type: 'text_delta', text: '前缀' });
    es.push({ type: 'text_delta', text: '增量' });
    expect(liveTextStore.get(CONV)).toBe('前缀增量');
  });
});

describe('既有面保持（失败方式 4；#857 收敛交接改写清语义）', () => {
  it('message 事件（assistant 文本行）：记 handoff 不清缓冲 + messages/plans 失效重取', () => {
    const qc = freshClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const es = startStream(qc);
    es.push({ type: 'text_delta', text: '段' });
    es.push({
      type: 'message',
      message: { id: 'm1', role: 'assistant', content: '终稿', createdAt: 1 },
    });
    // 重取在飞：缓冲保留（打字面不闪清）。
    expect(liveTextStore.get(CONV)).toBe('段');
    // 收敛前读数 = 全缓冲；收敛（messages 含 m1）后 = 空（落库行接管）。
    expect(liveTextStore.getVisible(CONV, new Set())).toBe('段');
    expect(liveTextStore.getVisible(CONV, new Set(['m1']))).toBe('');
    const keys = invalidate.mock.calls.map(([filters]) => filters as { queryKey?: string[] });
    expect(keys.some((f) => f.queryKey?.[0] === 'messages')).toBe(true);
    expect(keys.some((f) => f.queryKey?.[0] === 'plans')).toBe(true);
  });

  it('message 事件（工具行）：不记 handoff，缓冲保留', () => {
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
    // 前缀尚无落库行覆盖：即使 messages 已含该工具行，文本仍保留。
    expect(liveTextStore.get(CONV)).toBe('段');
    expect(liveTextStore.getVisible(CONV, new Set(['m-tool']))).toBe('段');
  });

  it('step 事件：失效重取、不动缓冲', () => {
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

  it('handlers 透传：onMessage/onStep 照常收到载荷', () => {
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

// —— #905 活动相位单槽（W2/W3 客户端半）————————————————————————————
// 失败方式：
//   1. activity 事件不入槽 → 活行永远黑盒（消费侧读不到）。
//   2. 步终态（done/failed/stopped）不清槽 → 死相位跨步残留，下一跑步
//      头上挂上一跑的「思考中」（消费侧 stepId 过滤是第二道防线，这里是
//      第一道）。
//   3. 流重建（resync）不清槽 → 陈旧相位在新订阅的 hub 补发到达前抢先呈现。
describe('活动相位单槽（#905）', () => {
  it('activity 事件入槽；后到覆盖先到（单槽语义）', () => {
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

  it('step 终态（done/failed/stopped）清槽；claimed 不清', () => {
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

  it('流重建即清槽：新订阅先作废旧相位，hub 补发接管', () => {
    activityStore.set(CONV, { stepId: 's0', phase: 'thinking', at: 50 });
    const qc = freshClient();
    FakeEventSource.instances = [];
    startConversationStream(CONV, qc, {});
    expect(activityStore.get(CONV)).toBeNull();
    // 补发到达即入槽（server hub 的 lastActivity 快照）。
    const es = FakeEventSource.instances[0] as FakeEventSource;
    es.fireOpen();
    es.push({ type: 'activity', activity: { stepId: 's1', phase: 'tool', tool: 'read', at: 300 } });
    expect(activityStore.get(CONV)).toMatchObject({ phase: 'tool', tool: 'read' });
  });
});

// —— #1308 思考增量（客户端半）——————————————————————————————————————————
// 失败方式：
//   1. thinking_delta 不进 liveThinkingStore → 会话只有「模型思考中...」标签。
//   2. 思考增量误入 text_delta 通道，或正文增量误入思考缓冲。
//   3. 订阅 / 重连不清旧思考缓冲 → 补发快照叠成双份。
//   4. 思考段行到达不记 handoff → 落库行与在飞行叠成两份。
//   5. 步终态不清思考缓冲 → 下一跑残留上一跑的推理文本。
describe('思考增量（#1308）', () => {
  const thinkingRow = {
    id: 'm-think',
    role: 'assistant' as const,
    content: [{ type: 'thinking', thinking: 'REASONING-MARKER-1308' }],
    createdAt: 1,
  };

  it('thinking_delta 只进思考缓冲，不进正文缓冲', () => {
    const es = startStream(freshClient());
    es.push({ type: 'thinking_delta', text: 'REASONING-MARKER-1308' });
    expect(liveThinkingStore.get(CONV)).toBe('REASONING-MARKER-1308');
    expect(liveTextStore.get(CONV)).toBe('');
  });

  it('text_delta 不进思考缓冲', () => {
    const es = startStream(freshClient());
    es.push({ type: 'text_delta', text: 'answer' });
    expect(liveTextStore.get(CONV)).toBe('answer');
    expect(liveThinkingStore.get(CONV)).toBe('');
  });

  it('订阅前残留的思考缓冲在补发前已清空', () => {
    liveThinkingStore.append(CONV, '旧思考');
    FakeEventSource.instances = [];
    startConversationStream(CONV, freshClient(), {});
    expect(liveThinkingStore.get(CONV)).toBe('');
    const es = FakeEventSource.instances[0] as FakeEventSource;
    es.fireOpen();
    es.push({ type: 'thinking_delta', text: '补发思考' });
    expect(liveThinkingStore.get(CONV)).toBe('补发思考');
  });

  it('activity phase starting 清掉在飞思考（回落轮）', () => {
    const es = startStream(freshClient());
    es.push({ type: 'thinking_delta', text: '旧轮思考' });
    expect(liveThinkingStore.get(CONV)).toBe('旧轮思考');
    es.push({
      type: 'activity',
      activity: { stepId: 's1', phase: 'starting', at: 1 },
    });
    expect(liveThinkingStore.get(CONV)).toBe('');
  });

  it('重连 resync 作废旧思考缓冲，补发快照不叠加', () => {
    const es = startStream(freshClient());
    es.push({ type: 'thinking_delta', text: '断线前' });
    vi.advanceTimersByTime(20_000);
    const rebuilt = FakeEventSource.instances[1] as FakeEventSource;
    rebuilt.fireOpen();
    expect(liveThinkingStore.get(CONV)).toBe('');
    rebuilt.push({ type: 'thinking_delta', text: '断线前后缀' });
    expect(liveThinkingStore.get(CONV)).toBe('断线前后缀');
  });

  it('思考段行记 handoff：messages 含该行后可见缓冲为空', () => {
    const es = startStream(freshClient());
    es.push({ type: 'thinking_delta', text: 'REASONING-MARKER-1308' });
    es.push({ type: 'message', message: thinkingRow });
    expect(liveThinkingStore.get(CONV)).toBe('REASONING-MARKER-1308');
    expect(liveThinkingStore.getVisible(CONV, new Set())).toBe('REASONING-MARKER-1308');
    expect(liveThinkingStore.getVisible(CONV, new Set(['m-think']))).toBe('');
    expect(liveTextStore.get(CONV)).toBe('');
  });

  it('正文行不记思考 handoff', () => {
    const es = startStream(freshClient());
    es.push({ type: 'thinking_delta', text: '仍在飞' });
    es.push({
      type: 'message',
      message: { id: 'm-text', role: 'assistant', content: '终稿', createdAt: 2 },
    });
    expect(liveThinkingStore.getVisible(CONV, new Set(['m-text']))).toBe('仍在飞');
  });

  it('step 终态清思考缓冲；claimed 不清', () => {
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
