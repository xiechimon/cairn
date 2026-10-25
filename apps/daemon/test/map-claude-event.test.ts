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

  test('failure mode 11: auth-class failure wording names the machine + remedy (state.machineName)', () => {
    const state = createClaudeMapState({ machineName: 'daemon-mea' });
    const { events } = feed([ASSISTANT_AUTH_ERROR, RESULT_AUTH_ERROR], state);
    const err = events.find((e) => e.type === 'error') as { error: { message: string } };
    expect(err.error.message).toContain('daemon-mea');
    expect(err.error.message).toContain('ANTHROPIC_API_KEY');
    expect(err.error.message).toContain('/login');
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
});
