import { THINKING_LEVELS } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  type AgentSessionEventLike,
  mapPiSessionEvent,
  newMapState,
  PI_CAPABILITIES,
} from '../src/backend/pi.js';

function map(ev: AgentSessionEventLike, state = newMapState()) {
  return mapPiSessionEvent(ev, state);
}

describe('mapPiSessionEvent (AgentSessionEvent → StepEvent projection)', () => {
  test('text_delta → text_delta + message_update dual events', () => {
    const out = map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'OK' }] },
      assistantMessageEvent: { type: 'text_delta', delta: 'OK' },
    });
    expect(out).toEqual([
      { type: 'text_delta', text: 'OK' },
      {
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'OK' }] },
      },
    ]);
  });

  test('thinking_delta → thinking_delta; thinking_end → thinking (block full text)', () => {
    const msg = { role: 'assistant' };
    expect(
      map({
        type: 'message_update',
        message: msg,
        assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' },
      })[0],
    ).toEqual({ type: 'thinking_delta', text: 'hmm' });
    expect(
      map({
        type: 'message_update',
        message: msg,
        assistantMessageEvent: { type: 'thinking_end', content: 'hmm full' },
      }),
    ).toEqual([{ type: 'thinking', text: 'hmm full' }]);
  });

  test('toolcall_end in two parts: call block (no result) → execution done (with result, same id)', () => {
    const state = newMapState();
    const first = map(
      {
        type: 'message_update',
        message: { role: 'assistant' },
        assistantMessageEvent: {
          type: 'toolcall_end',
          toolCall: { id: 'c1', name: 'edit', arguments: { path: 'README.md' } },
        },
      },
      state,
    );
    expect(first).toEqual([
      { type: 'toolcall_end', call: { id: 'c1', name: 'edit', arguments: { path: 'README.md' } } },
    ]);
    const second = map(
      {
        type: 'tool_execution_end',
        toolCallId: 'c1',
        toolName: 'edit',
        result: { ok: 1 },
        isError: false,
      },
      state,
    );
    expect(second).toHaveLength(1);
    const call = (second[0] as { call: Record<string, unknown> }).call;
    expect(call.id).toBe('c1');
    expect(call.arguments).toEqual({ path: 'README.md' });
    expect(call.result).toEqual({ ok: 1 });
    expect(call.isError).toBe(false);
  });

  test('message_end accumulates usage (provider/model keys); done carries the accumulated value', () => {
    const state = newMapState();
    map(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: 'stub-gw',
          model: 'stub-model',
          stopReason: 'stop',
          usage: { input: 12, output: 980, cacheRead: 100, cacheWrite: 50 },
        },
      },
      state,
    );
    map(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: 'stub-gw',
          model: 'stub-model',
          stopReason: 'stop',
          usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
      },
      state,
    );
    const done = map({ type: 'agent_settled' }, state);
    expect(done).toEqual([
      {
        type: 'done',
        usage: [
          { model: 'stub-gw/stub-model', input: 13, output: 982, cacheRead: 100, cacheWrite: 50 },
        ],
      },
    ]);
  });

  test('agent_end never emits done (regardless of willRetry — convergence moved to agent_settled)', () => {
    expect(map({ type: 'agent_end', willRetry: true })).toEqual([]);
    expect(map({ type: 'agent_end', willRetry: false })).toEqual([]);
  });

  test('"the model will continue" path: a run follows agent_end(!willRetry), done is not emitted early', () => {
    const state = newMapState();
    map(
      {
        type: 'message_end',
        message: { role: 'assistant', provider: 'gw', model: 'm', stopReason: 'stop' },
      },
      state,
    );
    expect(map({ type: 'agent_end', willRetry: false }, state)).toEqual([]);
    const continued = map(
      {
        type: 'message_end',
        message: { role: 'assistant', provider: 'gw', model: 'm', stopReason: 'stop' },
      },
      state,
    );
    expect(continued.some((e) => e.type === 'done')).toBe(false);
    const done = map({ type: 'agent_settled' }, state);
    expect(done).toEqual([{ type: 'done', usage: [] }]);
  });

  test('"really finished" path: agent_settled emits done on time (reverse construction)', () => {
    const state = newMapState();
    map(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: 'gw',
          model: 'm',
          stopReason: 'stop',
          usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0 },
        },
      },
      state,
    );
    map({ type: 'agent_end', willRetry: false }, state);
    const done = map({ type: 'agent_settled' }, state);
    expect(done).toEqual([
      {
        type: 'done',
        usage: [{ model: 'gw/m', input: 5, output: 7, cacheRead: 0, cacheWrite: 0 }],
      },
    ]);
  });

  test('#927 cost: per-message usage.cost accumulated into per-model rows; done carries cost', () => {
    const state = newMapState();
    const first = map(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: 'stub-gw',
          model: 'stub-model',
          stopReason: 'stop',
          usage: {
            input: 0,
            output: 980,
            cacheRead: 100,
            cacheWrite: 0,
            cost: { input: 0, output: 1960, cacheRead: 50, cacheWrite: 0, total: 2010 },
          },
        },
      },
      state,
    );
    expect((first[0] as { message: { usage?: unknown } }).message.usage).toEqual({
      input: 0,
      output: 980,
      cacheRead: 100,
      cacheWrite: 0,
      cost: { input: 0, output: 1960, cacheRead: 50, cacheWrite: 0, total: 2010 },
    });
    map(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: 'stub-gw',
          model: 'stub-model',
          stopReason: 'stop',
          usage: {
            input: 3,
            output: 2,
            cacheRead: 1,
            cacheWrite: 0,
            cost: { input: 3, output: 4, cacheRead: 0.5, cacheWrite: 0, total: 7.5 },
          },
        },
      },
      state,
    );
    const done = map({ type: 'agent_settled' }, state);
    expect(done).toEqual([
      {
        type: 'done',
        usage: [
          {
            model: 'stub-gw/stub-model',
            input: 3,
            output: 982,
            cacheRead: 101,
            cacheWrite: 0,
            cost: { input: 3, output: 1964, cacheRead: 50.5, cacheWrite: 0, total: 2017.5 },
          },
        ],
      },
    ]);
  });

  test('#927 regression: usage without cost (old-shape projection) → four-dimension accumulation unchanged, no cost key produced', () => {
    const state = newMapState();
    map(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: 'p',
          model: 'm',
          stopReason: 'stop',
          usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
        },
      },
      state,
    );
    const done = map({ type: 'agent_settled' }, state);
    const usage = (done[0] as { usage: Record<string, unknown>[] }).usage[0]!;
    expect(usage).not.toHaveProperty('cost');
    expect(usage).toEqual({ model: 'p/m', input: 1, output: 2, cacheRead: 3, cacheWrite: 4 });
  });

  test('stopReason=length passes through rawStopReason / responseModel (#1512)', () => {
    const out = map({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: 'cut off',
        stopReason: 'length',
        rawStopReason: 'max_tokens',
        responseModel: 'claude-opus-4',
      },
    });
    expect(out).toEqual([
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: 'cut off',
          stopReason: 'length',
          rawStopReason: 'max_tokens',
          responseModel: 'claude-opus-4',
        },
      },
    ]);
  });

  test('stopReason=error → message_end + error{retryable verdict}; aborted → message_stop', () => {
    const err = map({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: 'rate limit hit' },
    });
    expect(err[1]).toEqual({
      type: 'error',
      error: { message: 'rate limit hit', retryable: true },
    });
    const fatal = map({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: 'invalid prompt' },
    });
    expect((fatal[1] as { error: { retryable: boolean } }).error.retryable).toBe(false);
    const decorated = mapPiSessionEvent(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'Stream ended without finish_reason',
        },
      },
      newMapState({
        diagnose: (m) =>
          `${m}\nprovider response: POST http://host/chat/completions -> 200 text/html (not an SSE stream); first bytes: "<!doctype html>"; status 500 note`,
      }),
    );
    expect((decorated[1] as { error: { message: string } }).error.message).toContain(
      'POST http://host/chat/completions -> 200 text/html',
    );
    expect((decorated[1] as { error: { retryable: boolean } }).error.retryable).toBe(false);
    const stopped = map({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'aborted' },
    });
    expect(stopped).toEqual([
      {
        type: 'message_stop',
        message: { role: 'assistant', content: null, stopReason: 'aborted' },
      },
    ]);
  });

  test('auto_retry_start/end and compaction_start/end pass through same-named', () => {
    expect(map({ type: 'auto_retry_start', attempt: 2 })).toEqual([
      { type: 'auto_retry_start', attempt: 2 },
    ]);
    expect(map({ type: 'auto_retry_end', attempt: 2 })).toEqual([
      { type: 'auto_retry_end', attempt: 2 },
    ]);
    expect(map({ type: 'compaction_start' })).toEqual([{ type: 'compaction_start' }]);
    expect(map({ type: 'compaction_end' })).toEqual([{ type: 'compaction_end' }]);
  });

  test('non-vocabulary events (agent_start/turn_end/queue_update family) produce no StepEvent', () => {
    for (const type of [
      'agent_start',
      'turn_start',
      'turn_end',
      'queue_update',
      'entry_appended',
    ]) {
      expect(map({ type })).toEqual([]);
    }
  });

  test('toolResult role projected to the message vocabulary (system/user/assistant, r5 §3.6)', () => {
    const out = map({ type: 'message_end', message: { role: 'toolResult', content: 'r' } });
    expect((out[0] as { message: { role: string } }).message.role).toBe('system');
  });
});

describe('PI_CAPABILITIES (01 §5 capability surface)', () => {
  test('name/oauth four providers / seven thinking levels / compaction / sessionResume', () => {
    expect(PI_CAPABILITIES.name).toBe('pi');
    expect(PI_CAPABILITIES.oauthProviders).toEqual([
      'anthropic',
      'openai-codex',
      'github-copilot',
      'xai',
    ]);
    expect(PI_CAPABILITIES.thinkingLevels).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(PI_CAPABILITIES.thinkingLevels).toBe(THINKING_LEVELS);
    expect(PI_CAPABILITIES.compaction).toBe(true);
    expect(PI_CAPABILITIES.sessionResume).toBe(true);
  });
});
