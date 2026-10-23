// claude SDKMessage → StepEvent 映射（spec 17 §事件映射表，A5/A6/A7；
// #622 失败方式 5「事件映射漂出词表」）。
// 映射法与 pi 同律：mapClaudeMessage(msg, state) 纯函数 + 显式 state
// （工具调用回填、usage 捕获、session_id 刮取、interrupt 判定）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 映射漂出词表 → 全序列产出逐一过 stepEventSchema.parse（16 型锁定）
//   2. 文本/思考增量丢失或错字 → text_delta / thinking_delta 逐字
//   3. thinking 块终无全文 → `thinking` 事件全文（词表语义：块终全文）
//   4. 工具调用 result 回填缺失 → assistant 帧 pending → user 帧 tool_result
//      终稿必含（pi 两段发射同律：先无 result、后带 result + isError）
//   5. message_end 投影漂移 → role/content 原样投影
//   6. usage 映射错（字段对调/漏前缀）→ modelUsage 行集 + claude-code/ 前缀
//      （r3 §1.5 model 键形）；modelUsage 缺席 → usage 单行合成
//   7. 终态错路由：success → done；error_* 非 interrupt → error（retryable
//      判定）；interrupt → message_stop
//   8. session_id 未刮出 → init 帧落 state（A7 resume 通道）
//   9. 词表外成员（status/hook/log、非 tool_result user 帧）→ 静默不计
//  10. subtype success + is_error（CLI 的 API 错形，如缺凭据）→ error 不得折成
//      done（#867 T6；原映射只看 subtype，凭据拒绝被当作正常收工）
//  11. auth 类失败 → 文案点名机器 + 凭据类 + 补法（state.machineName 注入）

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { type StepEvent, stepEventSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { createClaudeMapState, mapClaudeMessage } from '../src/backend/claude-code.js';

/** 逐条喂入，收全量产出（顺序保真）。 */
function feed(
  msgs: SDKMessage[],
  state = createClaudeMapState(),
): {
  events: StepEvent[];
  state: ReturnType<typeof createClaudeMapState>;
} {
  const events: StepEvent[] = [];
  for (const msg of msgs) events.push(...mapClaudeMessage(msg, state));
  return { events, state };
}

const INIT: SDKMessage = {
  type: 'system',
  subtype: 'init',
  session_id: 'sdk-sess-uuid-1',
} as SDKMessage;

const TEXT_DELTA: SDKMessage = {
  type: 'stream_event',
  event: {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: '方案' },
  },
} as SDKMessage;

const THINKING_DELTA: SDKMessage = {
  type: 'stream_event',
  event: {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'thinking_delta', thinking: '先读文件' },
  },
} as SDKMessage;

const ASSISTANT_TEXT: SDKMessage = {
  type: 'assistant',
  message: {
    id: 'msg_1',
    role: 'assistant',
    content: [{ type: 'text', text: '方案已定' }],
    model: 'claude-sonnet-4-5',
    stop_reason: 'end_turn',
  },
} as SDKMessage;

const ASSISTANT_TOOL: SDKMessage = {
  type: 'assistant',
  message: {
    id: 'msg_2',
    role: 'assistant',
    content: [
      { type: 'text', text: '读文件' },
      { type: 'tool_use', id: 'toolu_1', name: 'read', input: { path: 'a.md' } },
    ],
    model: 'claude-sonnet-4-5',
    stop_reason: 'tool_use',
  },
} as SDKMessage;

const USER_TOOL_RESULT: SDKMessage = {
  type: 'user',
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: '文件内容 ABC',
        is_error: false,
      },
    ],
  },
} as SDKMessage;

const USER_PLAIN: SDKMessage = {
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text: '继续' }] },
} as SDKMessage;

const COMPACT: SDKMessage = {
  type: 'system',
  subtype: 'compact_boundary',
  compact_metadata: { trigger: 'auto', pre_tokens: 120_000 },
} as SDKMessage;

const API_RETRY: SDKMessage = {
  type: 'system',
  subtype: 'api_retry',
  attempt: 2,
  max_retries: 3,
  retry_delay_ms: 1_000,
  error_status: 429,
  error: { type: 'api_error', message: 'rate limit' },
  uuid: 'retry-uuid',
  session_id: 'sdk-sess-uuid-1',
} as unknown as SDKMessage;

const RESULT_SUCCESS: SDKMessage = {
  type: 'result',
  subtype: 'success',
  result: '收工',
  usage: {
    input_tokens: 10,
    output_tokens: 20,
    cache_read_input_tokens: 5,
    cache_creation_input_tokens: 7,
  },
  modelUsage: {
    'claude-sonnet-4-5': {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 7,
      costUSD: 0.01,
      webSearchRequests: 0,
    },
  },
  is_error: false,
  duration_ms: 1_000,
  duration_api_ms: 900,
  num_turns: 1,
  total_cost_usd: 0.01,
  session_id: 'sdk-sess-uuid-1',
} as unknown as SDKMessage;

const RESULT_ERROR: SDKMessage = {
  type: 'result',
  subtype: 'error_max_turns',
  errors: ['reached max turns'],
  usage: { input_tokens: 1, output_tokens: 2 },
  is_error: true,
  duration_ms: 100,
  duration_api_ms: 90,
  num_turns: 5,
  total_cost_usd: 0,
  session_id: 'sdk-sess-uuid-1',
} as unknown as SDKMessage;

/** 机器缺 claude 凭据时的实测形（#867 T6，2026-10-05 本机空 HOME 取样）：
 * subtype 仍是 success，`is_error:true` 才是真话，错误文本在 result 字段。 */
const RESULT_AUTH_ERROR: SDKMessage = {
  type: 'result',
  subtype: 'success',
  is_error: true,
  result: 'Not logged in · Please run /login',
  usage: { input_tokens: 0, output_tokens: 0 },
  num_turns: 1,
  total_cost_usd: 0,
  session_id: 'sdk-sess-uuid-1',
} as unknown as SDKMessage;

/** 同轮的 assistant 帧（结构化错误类；auth 文案在 content 里）。 */
const ASSISTANT_AUTH_ERROR: SDKMessage = {
  type: 'assistant',
  error: 'authentication_failed',
  message: {
    id: 'msg_auth',
    role: 'assistant',
    content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
    model: '<synthetic>',
    stop_reason: 'stop_sequence',
  },
} as unknown as SDKMessage;

describe('mapClaudeMessage（spec 17 事件映射表，词表 01 §5 锁定）', () => {
  test('失败方式 1：全序列产出过 stepEventSchema（映射不漂出 16 型词表）', () => {
    const { events } = feed([
      INIT,
      THINKING_DELTA,
      TEXT_DELTA,
      ASSISTANT_TEXT,
      ASSISTANT_TOOL,
      USER_TOOL_RESULT,
      COMPACT,
      API_RETRY,
      RESULT_SUCCESS,
    ]);
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) expect(() => stepEventSchema.parse(ev)).not.toThrow();
  });

  test('失败方式 2：text_delta / thinking_delta 逐字透传', () => {
    const { events } = feed([THINKING_DELTA, TEXT_DELTA]);
    expect(events).toEqual([
      { type: 'thinking_delta', text: '先读文件' },
      { type: 'text_delta', text: '方案' },
    ]);
  });

  test('失败方式 3：assistant 帧 thinking 块 → thinking 块终全文', () => {
    const assistantThinking: SDKMessage = {
      type: 'assistant',
      message: {
        id: 'msg_0',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '先读文件再改' }],
        model: 'claude-sonnet-4-5',
        stop_reason: null,
      },
    } as SDKMessage;
    const { events } = feed([assistantThinking]);
    const ev = events.find((e) => e.type === 'thinking');
    expect(ev).toEqual({ type: 'thinking', text: '先读文件再改' });
  });

  test('失败方式 4：tool_use 两段发射——assistant 帧无 result、user 帧回填终稿', () => {
    const { events } = feed([ASSISTANT_TOOL, USER_TOOL_RESULT]);
    const calls = events.filter((e) => e.type === 'toolcall_end');
    expect(calls).toHaveLength(2);
    const [pending, final] = calls as Extract<StepEvent, { type: 'toolcall_end' }>[];
    // 第一段：pending（无 result——live 面缺省，词表语义）。
    expect(pending!.call.id).toBe('toolu_1');
    expect(pending!.call.name).toBe('read');
    expect(pending!.call.arguments).toEqual({ path: 'a.md' });
    expect(pending!.call.result).toBeUndefined();
    // 第二段：终稿必含 result（runner 以 result!==undefined 门控 relay）。
    expect(final!.call).toEqual({
      id: 'toolu_1',
      name: 'read',
      arguments: { path: 'a.md' },
      result: '文件内容 ABC',
      isError: false,
    });
  });

  test('失败方式 5：assistant 帧终 → message_end role/content 原样投影', () => {
    const { events } = feed([ASSISTANT_TEXT]);
    const ev = events.find((e) => e.type === 'message_end');
    expect(ev).toEqual({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '方案已定' }],
      },
    });
  });

  test('失败方式 6：usage 行集——modelUsage 投影 + claude-code/ 键前缀', () => {
    const { events, state } = feed([RESULT_SUCCESS]);
    const done = events.find((e) => e.type === 'done');
    expect(done).toEqual({
      type: 'done',
      usage: [
        {
          model: 'claude-code/claude-sonnet-4-5',
          input: 10,
          output: 20,
          cacheRead: 5,
          cacheWrite: 7,
        },
      ],
    });
    // handle.usage() 同源（pi 同律：state 捕获，流后可查）。
    expect(state.usage).toEqual([
      {
        model: 'claude-code/claude-sonnet-4-5',
        input: 10,
        output: 20,
        cacheRead: 5,
        cacheWrite: 7,
      },
    ]);
  });

  test('失败方式 6b：modelUsage 缺席 → usage 单行合成（opts.modelId 兜底）', () => {
    const result = { ...RESULT_SUCCESS, modelUsage: undefined } as unknown as SDKMessage;
    const { events } = feed([result], createClaudeMapState({ modelId: 'claude-sonnet-4-5' }));
    const done = events.find((e) => e.type === 'done');
    expect(done).toEqual({
      type: 'done',
      usage: [
        {
          model: 'claude-code/claude-sonnet-4-5',
          input: 10,
          output: 20,
          cacheRead: 5,
          cacheWrite: 7,
        },
      ],
    });
  });

  test('失败方式 7：终态路由——success→done；error_* 非 interrupt→error；interrupt→message_stop', () => {
    // error_*（非 interrupt）→ error（retryable 判定走文案 regex，与 pi 同律）。
    const { events: errEvents } = feed([RESULT_ERROR]);
    const err = errEvents.find((e) => e.type === 'error');
    expect(err).toEqual({
      type: 'error',
      error: { message: 'reached max turns', retryable: false },
    });
    expect(errEvents.some((e) => e.type === 'done')).toBe(false);

    // interrupt（state.interrupted）→ message_stop（词表语义：流被停止）。
    const state = createClaudeMapState();
    state.interrupted = true;
    const { events: stopEvents } = feed([RESULT_ERROR], state);
    expect(stopEvents.find((e) => e.type === 'message_stop')).toBeDefined();
    expect(stopEvents.some((e) => e.type === 'error')).toBe(false);
  });

  test('失败方式 10：subtype success + is_error → error 事件（不得折成 done）', () => {
    // #867 T6 的核心缺陷面：CLI 在 API 出错时仍发 subtype:"success"，
    // is_error 才是真话。原映射只看 subtype → 零 token 的拒绝被当成正常
    // 收工（步静默 success、零产出）。本用例只喂 result 帧（无 assistant
    // 错误类）= 一切 is_error 的公共臂：文案 = CLI 原文，不被 auth 话术覆盖。
    const { events } = feed([RESULT_AUTH_ERROR]);
    expect(events.some((e) => e.type === 'done')).toBe(false);
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect((err as { error: { message: string } }).error.message).toContain(
      'Not logged in · Please run /login',
    );
  });

  test('失败方式 11：auth 类失败文案点名机器 + 补法（state.machineName）', () => {
    const state = createClaudeMapState({ machineName: 'daemon-mea' });
    const { events } = feed([ASSISTANT_AUTH_ERROR, RESULT_AUTH_ERROR], state);
    const err = events.find((e) => e.type === 'error') as { error: { message: string } };
    expect(err.error.message).toContain('daemon-mea');
    expect(err.error.message).toContain('ANTHROPIC_API_KEY');
    expect(err.error.message).toContain('/login');
  });

  test('失败方式 8：system init 的 session_id 刮进 state（A7 resume 通道）', () => {
    const { state } = feed([INIT]);
    expect(state.sessionId).toBe('sdk-sess-uuid-1');
    expect(feed([INIT]).events).toHaveLength(0); // 不入事件面
  });

  test('失败方式 9：词表外成员静默不计（compact/api_retry 之外的杂帧）', () => {
    const statusLike: SDKMessage = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '系统注记' }] },
    } as SDKMessage;
    const { events } = feed([USER_PLAIN, statusLike]);
    expect(events).toHaveLength(0);
  });

  test('compact_boundary → compaction 单事件（边界原子标记，非 start/end 对）', () => {
    const { events } = feed([COMPACT]);
    expect(events).toEqual([{ type: 'compaction' }]);
  });

  test('api_retry → auto_retry_start(attempt)（runner 消费面：清前错 + 日志）', () => {
    const { events } = feed([API_RETRY]);
    expect(events).toEqual([{ type: 'auto_retry_start', attempt: 2 }]);
  });
});
