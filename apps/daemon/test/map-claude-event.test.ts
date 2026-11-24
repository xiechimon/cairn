import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { type StepEvent, stepEventSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { createClaudeMapState, mapClaudeMessage } from '../src/backend/claude-code.js';

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

describe('mapClaudeMessage (spec 17 event mapping table, vocabulary locked by 01 §5)', () => {
  test('failure mode 1: the whole sequence passes stepEventSchema (mapping never drifts outside the 16-type vocabulary)', () => {
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

  test('failure mode 2: text_delta / thinking_delta pass through verbatim', () => {
    const { events } = feed([THINKING_DELTA, TEXT_DELTA]);
    expect(events).toEqual([
      { type: 'thinking_delta', text: '先读文件' },
      { type: 'text_delta', text: '方案' },
    ]);
  });

  test('failure mode 3: assistant-frame thinking block → thinking block with final full text', () => {
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

  test('failure mode 4: tool_use emitted in two parts — assistant frame without result, user frame backfills the final draft', () => {
    const { events } = feed([ASSISTANT_TOOL, USER_TOOL_RESULT]);
    const calls = events.filter((e) => e.type === 'toolcall_end');
    expect(calls).toHaveLength(2);
    const [pending, final] = calls as Extract<StepEvent, { type: 'toolcall_end' }>[];
    expect(pending!.call.id).toBe('toolu_1');
    expect(pending!.call.name).toBe('read');
    expect(pending!.call.arguments).toEqual({ path: 'a.md' });
    expect(pending!.call.result).toBeUndefined();
    expect(final!.call).toEqual({
      id: 'toolu_1',
      name: 'read',
      arguments: { path: 'a.md' },
      result: '文件内容 ABC',
      isError: false,
    });
  });

  test('a host tool reports its Cairn name, as the pi backend does; another MCP server keeps its prefix', () => {
    const hostCall = {
      type: 'assistant',
      message: {
        id: 'msg_3',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_2', name: 'mcp__cairn__create_todo', input: {} },
          { type: 'tool_use', id: 'toolu_3', name: 'mcp__github__search', input: {} },
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'tool_use',
      },
    } as SDKMessage;
    const hostResult = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: '{}', is_error: false }],
      },
    } as SDKMessage;
    const names = feed([hostCall, hostResult])
      .events.filter((e) => e.type === 'toolcall_end')
      .map((e) => (e as Extract<StepEvent, { type: 'toolcall_end' }>).call.name);
    expect(names).toEqual(['create_todo', 'mcp__github__search', 'create_todo']);
  });

  test('failure mode 5: assistant frame ends → message_end role/content projected verbatim', () => {
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

  test('failure mode 6: usage row set — modelUsage projection + claude-code/ key prefix', () => {
    const { events, state } = feed([RESULT_SUCCESS]);
    const done = events.find((e) => e.type === 'done');
    const row = {
      model: 'claude-code/claude-sonnet-4-5',
      input: 10,
      output: 20,
      cacheRead: 5,
      cacheWrite: 7,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
    };
    expect(done).toEqual({ type: 'done', usage: [row] });
    expect(state.usage).toEqual([row]);
  });

  test('main-loop assistant messages report running usage, each message once, without sub-agents', () => {
    const state = createClaudeMapState();
    const call = (id: string, output: number, parent: string | null = null) =>
      mapClaudeMessage(
        {
          type: 'assistant',
          parent_tool_use_id: parent,
          message: {
            id,
            role: 'assistant',
            model: 'claude-sonnet-4-5',
            content: [{ type: 'text', text: id }],
            usage: { input_tokens: 3, cache_read_input_tokens: 100, output_tokens: output },
          },
        } as unknown as SDKMessage,
        state,
      ).filter((e) => e.type === 'usage');
    expect(call('a', 10)).toHaveLength(1);
    call('a', 25);
    expect(call('sub', 9_000, 'toolu_task')).toEqual([]);
    expect(call('b', 7)).toEqual([
      {
        type: 'usage',
        usage: [
          {
            model: 'claude-code/claude-sonnet-4-5',
            input: 6,
            output: 32,
            cacheRead: 200,
            cacheWrite: 0,
          },
        ],
      },
    ]);
    expect(state.usage).toEqual([]);
  });

  test('sub-agent frames keep only their tool calls, tagged with the spawning call; their text never reaches the main agent', () => {
    const sub = { parent_tool_use_id: 'toolu_spawn' };
    const { events } = feed([
      { ...TEXT_DELTA, ...sub } as SDKMessage,
      { ...THINKING_DELTA, ...sub } as SDKMessage,
      {
        type: 'assistant',
        ...sub,
        message: {
          id: 'msg_sub',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'sub thinks' },
            { type: 'text', text: 'sub says' },
            { type: 'tool_use', id: 'toolu_child', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      } as unknown as SDKMessage,
      {
        type: 'user',
        ...sub,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_child', content: 'a\nb' }],
        },
      } as unknown as SDKMessage,
      TEXT_DELTA,
    ]);
    expect(events).toEqual([
      {
        type: 'toolcall_end',
        call: {
          id: 'toolu_child',
          name: 'Bash',
          arguments: { command: 'ls' },
          parent: 'toolu_spawn',
        },
      },
      {
        type: 'toolcall_end',
        call: {
          id: 'toolu_child',
          name: 'Bash',
          arguments: { command: 'ls' },
          parent: 'toolu_spawn',
          result: 'a\nb',
          isError: false,
        },
      },
      { type: 'text_delta', text: '方案' },
    ]);
  });

  test('the usage row carries the last top-level request as contextTokens, so the composer context ring has data', () => {
    const call = (
      id: string,
      usage: Record<string, number>,
      parent: string | null = null,
    ): SDKMessage =>
      ({
        type: 'assistant',
        parent_tool_use_id: parent,
        message: {
          id,
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: id }],
          usage,
        },
      }) as unknown as SDKMessage;
    const { events } = feed([
      call('first', { input_tokens: 4, cache_creation_input_tokens: 50_819, output_tokens: 79 }),
      call('subagent', { input_tokens: 900_000, output_tokens: 1 }, 'toolu_task'),
      call('last', {
        input_tokens: 2,
        cache_read_input_tokens: 50_819,
        cache_creation_input_tokens: 2_178,
        output_tokens: 351,
      }),
      RESULT_SUCCESS,
    ]);
    const done = events.find((e) => e.type === 'done');
    expect(done?.type === 'done' && done.usage).toEqual([
      expect.objectContaining({
        model: 'claude-code/claude-sonnet-4-5',
        input: 10,
        contextTokens: 2 + 50_819 + 2_178 + 351,
      }),
    ]);
  });

  test('failure mode 6c: costBasis unknown drops costUSD; a list price is kept on total only', () => {
    const unknownBasis = {
      ...RESULT_SUCCESS,
      modelUsage: {
        'claude-sonnet-4-5': {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadInputTokens: 5,
          cacheCreationInputTokens: 7,
          costUSD: 0.01,
          costBasis: 'unknown',
        },
      },
    } as unknown as SDKMessage;
    const { events: unknownEvents } = feed([unknownBasis]);
    const unknownDone = unknownEvents.find((e) => e.type === 'done');
    expect(unknownDone).toEqual({
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

    const listed = {
      ...RESULT_SUCCESS,
      modelUsage: {
        'claude-sonnet-4-5': {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadInputTokens: 5,
          cacheCreationInputTokens: 0,
          costUSD: 0.01,
          costBasis: 'list',
        },
      },
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 4 },
      },
    } as unknown as SDKMessage;
    const { events } = feed([listed]);
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
          cacheWrite1h: 4,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
        },
      ],
    });
  });

  test('failure mode 6b: modelUsage absent → single usage row synthesized (opts.modelId fallback)', () => {
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

  test('failure mode 7: terminal routing — success→done; error_* non-interrupt→error; interrupt→message_stop', () => {
    const { events: errEvents } = feed([RESULT_ERROR]);
    const err = errEvents.find((e) => e.type === 'error');
    expect(err).toEqual({
      type: 'error',
      error: { message: 'reached max turns', retryable: false },
    });
    expect(errEvents.some((e) => e.type === 'done')).toBe(false);

    const state = createClaudeMapState();
    state.interrupted = true;
    const { events: stopEvents } = feed([RESULT_ERROR], state);
    expect(stopEvents.find((e) => e.type === 'message_stop')).toBeDefined();
    expect(stopEvents.some((e) => e.type === 'error')).toBe(false);
  });

  test('failure mode 10: subtype success + is_error → error event (must not be folded into done)', () => {
    const { events } = feed([RESULT_AUTH_ERROR]);
    expect(events.some((e) => e.type === 'done')).toBe(false);
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect((err as { error: { message: string } }).error.message).toContain(
      'Not logged in · Please run /login',
    );
  });

  test('failure mode 11: auth-class failure wording names the team subscription remedy', () => {
    const { events } = feed([ASSISTANT_AUTH_ERROR, RESULT_AUTH_ERROR]);
    const err = events.find((e) => e.type === 'error') as { error: { message: string } };
    expect(err.error.message).toContain('claude setup-token');
    expect(err.error.message).toContain('设置 → 模型路由');
    expect(err.error.message).not.toContain('ANTHROPIC_API_KEY');
  });

  test('an API error the CLI reports as an assistant message is the turn error, never a reply', () => {
    const text =
      'API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required';
    const { events } = feed([
      {
        type: 'assistant',
        error: 'invalid_request',
        message: {
          id: 'msg_api_error',
          role: 'assistant',
          content: [{ type: 'text', text }],
          model: '<synthetic>',
          stop_reason: 'stop_sequence',
        },
      } as unknown as SDKMessage,
      {
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: text,
        usage: { input_tokens: 0, output_tokens: 0 },
        num_turns: 1,
        total_cost_usd: 0,
        session_id: 'sdk-sess-uuid-1',
      } as unknown as SDKMessage,
    ]);
    expect(events.filter((e) => e.type === 'message_end')).toEqual([]);
    expect(events.find((e) => e.type === 'error')).toEqual({
      type: 'error',
      error: { message: text, retryable: false },
    });
  });

  test("failure mode 8: system init's session_id scraped into state (A7 resume channel)", () => {
    const { state } = feed([INIT]);
    expect(state.sessionId).toBe('sdk-sess-uuid-1');
    expect(feed([INIT]).events).toHaveLength(0);
  });

  test('failure mode 9: out-of-vocabulary members silently ignored (stray frames other than compact/api_retry)', () => {
    const statusLike: SDKMessage = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '系统注记' }] },
    } as SDKMessage;
    const { events } = feed([USER_PLAIN, statusLike]);
    expect(events).toHaveLength(0);
  });

  test('compact_boundary → single compaction event (atomic boundary marker, not a start/end pair)', () => {
    const { events } = feed([COMPACT]);
    expect(events).toEqual([{ type: 'compaction' }]);
  });

  test('api_retry → auto_retry_start(attempt) (runner consumer surface: clears previous error + logs)', () => {
    const { events } = feed([API_RETRY]);
    expect(events).toEqual([{ type: 'auto_retry_start', attempt: 2 }]);
  });

  test('rate_limit_event is kept on the map state and emits no step event', () => {
    const msg = {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'rejected',
        rateLimitType: 'five_hour',
        utilization: 1,
        resetsAt: 1_700_000_000,
      },
      uuid: '11111111-1111-4111-8111-111111111111',
      session_id: 'sdk-sess-uuid-1',
    } as SDKMessage;
    const { events, state } = feed([msg]);
    expect(events).toEqual([]);
    expect(state.rateLimits).toEqual([
      {
        status: 'rejected',
        rateLimitType: 'five_hour',
        utilization: 1,
        resetsAt: 1_700_000_000,
      },
    ]);
  });

  test('rate_limit_event with unifiedWindows emits one notice per window under the event status', () => {
    const msg = {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed_warning',
        rateLimitType: 'seven_day',
        utilization: 0.6,
        resetsAt: 1_800_000_000,
        unifiedWindows: {
          five_hour: { utilization: 0.01, resetsAt: 1_700_003_600 },
          seven_day: { utilization: 0.6, resetsAt: 1_800_000_000 },
        },
      },
      uuid: '22222222-2222-4222-8222-222222222222',
      session_id: 'sdk-sess-uuid-1',
    } as SDKMessage;
    const { events, state } = feed([msg]);
    expect(events).toEqual([]);
    expect(state.rateLimits).toEqual([
      {
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilization: 0.01,
        resetsAt: 1_700_003_600,
      },
      {
        status: 'allowed_warning',
        rateLimitType: 'seven_day',
        utilization: 0.6,
        resetsAt: 1_800_000_000,
      },
    ]);
  });

  test('a top-level rate limit type absent from unifiedWindows is emitted beside the windows', () => {
    const msg = {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'rejected',
        rateLimitType: 'seven_day',
        utilization: 1,
        resetsAt: 1_800_000_000,
        unifiedWindows: {
          five_hour: { utilization: 1, resetsAt: 1_700_003_600 },
        },
      },
      uuid: '33333333-3333-4333-8333-333333333333',
      session_id: 'sdk-sess-uuid-1',
    } as SDKMessage;
    const { state } = feed([msg]);
    expect(state.rateLimits).toEqual([
      {
        status: 'rejected',
        rateLimitType: 'five_hour',
        utilization: 1,
        resetsAt: 1_700_003_600,
      },
      {
        status: 'rejected',
        rateLimitType: 'seven_day',
        utilization: 1,
        resetsAt: 1_800_000_000,
      },
    ]);
  });

  test('malformed unifiedWindows entries are skipped without dropping the valid ones', () => {
    const msg = {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'rejected',
        unifiedWindows: {
          '': { utilization: 1, resetsAt: 1_700_003_600 },
          five_hour: 'not-an-object',
          seven_day: { utilization: 'half', resetsAt: 1_800_000_000 },
        },
      },
      uuid: '44444444-4444-4444-8444-444444444444',
      session_id: 'sdk-sess-uuid-1',
    } as SDKMessage;
    const { state } = feed([msg]);
    expect(state.rateLimits).toEqual([
      {
        status: 'rejected',
        rateLimitType: 'seven_day',
        resetsAt: 1_800_000_000,
      },
      { status: 'rejected' },
    ]);
  });

  test('resumed session reports per-turn usage instead of cumulative result.modelUsage', () => {
    const state = createClaudeMapState({ modelId: 'claude-opus-5-5', resumed: true });
    const { events } = feed(
      [
        {
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            id: 'msg_turn2_main',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: [{ type: 'text', text: '收到' }],
            usage: {
              input_tokens: 4,
              output_tokens: 62,
              cache_read_input_tokens: 17_322,
              cache_creation_input_tokens: 670,
            },
          },
        } as unknown as SDKMessage,
        {
          type: 'result',
          subtype: 'success',
          result: '收到',
          is_error: false,
          usage: {
            input_tokens: 4,
            output_tokens: 62,
            cache_read_input_tokens: 17_322,
            cache_creation_input_tokens: 670,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 670 },
          },
          modelUsage: {
            'claude-opus-5-5': {
              inputTokens: 12,
              outputTokens: 417,
              cacheReadInputTokens: 61_634,
              cacheCreationInputTokens: 7_215,
              contextWindow: 183_000,
              costUSD: 0.14,
            },
            'claude-haiku-4-5': {
              inputTokens: 1_994,
              outputTokens: 17,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              costUSD: 0.002,
            },
          },
          session_id: 'sdk-sess-resumed',
        } as unknown as SDKMessage,
      ],
      state,
    );
    const done = events.find((e) => e.type === 'done');
    expect(done).toEqual({
      type: 'done',
      usage: [
        {
          model: 'claude-code/claude-opus-5-5',
          input: 4,
          output: 62,
          cacheRead: 17_322,
          cacheWrite: 670,
          cacheWrite1h: 670,
          contextTokens: 4 + 62 + 17_322 + 670,
          contextWindow: 183_000,
        },
      ],
    });
  });

  test('resumed session falls back to per-turn result.usage when assistant messages had no usage', () => {
    const state = createClaudeMapState({ modelId: 'claude-opus-5-5', resumed: true });
    const { events } = feed(
      [
        {
          type: 'result',
          subtype: 'success',
          result: 'ok',
          is_error: false,
          usage: {
            input_tokens: 5,
            output_tokens: 15,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 20,
          },
          modelUsage: {
            'claude-opus-5-5': {
              inputTokens: 500,
              outputTokens: 900,
              cacheReadInputTokens: 50_000,
              cacheCreationInputTokens: 6_000,
              contextWindow: 200_000,
            },
          },
          session_id: 'sdk-sess-resumed',
        } as unknown as SDKMessage,
      ],
      state,
    );
    const done = events.find((e) => e.type === 'done');
    expect(done).toEqual({
      type: 'done',
      usage: [
        {
          model: 'claude-code/claude-opus-5-5',
          input: 5,
          output: 15,
          cacheRead: 100,
          cacheWrite: 20,
        },
      ],
    });
  });
});
