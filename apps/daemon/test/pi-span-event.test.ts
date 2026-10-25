import { parseOtlpTarget, stepOtelContext } from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PiStepSpanSink } from '../src/backend/otel.js';
import { type AgentSessionEventLike, recordPiSpanEvent } from '../src/backend/pi.js';

const env = { CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:3000/api/public/otel' };

afterEach(() => {
  vi.unstubAllGlobals();
});

function harness() {
  const captured: { body: { resourceSpans: { scopeSpans: { spans: unknown[] }[] }[] } }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      captured.push({ body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 200 });
    }),
  );
  const target = parseOtlpTarget(env)!;
  const ctx = stepOtelContext('build-abc', 'step-xyz', target);
  const sink = new PiStepSpanSink(ctx, { provider: 'stub-gw', model: 'stub-model' });
  return {
    sink,
    spans: () =>
      captured.flatMap((c) =>
        c.body.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)),
      ) as {
        name: string;
        parentSpanId?: string;
        attributes: { key: string; value: unknown }[];
      }[],
  };
}

describe('recordPiSpanEvent', () => {
  test('maps message_end into a chat span and tool events into an execute_tool span', async () => {
    const { sink, spans } = harness();
    const toolStart: AgentSessionEventLike = {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_end',
        toolCall: { id: 'call-9', name: 'edit', arguments: { path: 'a.ts' } },
      },
    };
    const toolEnd: AgentSessionEventLike = {
      type: 'tool_execution_end',
      toolCallId: 'call-9',
      toolName: 'edit',
      result: 'ok',
      isError: false,
    };
    const messageEnd: AgentSessionEventLike = {
      type: 'message_end',
      message: {
        role: 'assistant',
        provider: 'anthropic',
        model: 'claude-sonnet',
        stopReason: 'stop',
        rawStopReason: 'end_turn',
        responseModel: 'claude-sonnet-4-5',
        usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, cost: { total: 0.002 } },
      },
    };
    recordPiSpanEvent(sink, toolStart);
    recordPiSpanEvent(sink, toolEnd);
    recordPiSpanEvent(sink, messageEnd);
    await sink.flush();
    const sent = spans();
    expect(sent).toHaveLength(2);
    const tool = sent.find((s) => s.name.startsWith('execute_tool'))!;
    expect(tool.parentSpanId).toBe('68de601387c7a961');
    const toolAttrs = Object.fromEntries(tool.attributes.map((a) => [a.key, a.value]));
    expect(toolAttrs['gen_ai.tool.call.id']).toEqual({ stringValue: 'call-9' });
    const chat = sent.find((s) => s.name.startsWith('chat'))!;
    const chatAttrs = Object.fromEntries(chat.attributes.map((a) => [a.key, a.value]));
    expect(chatAttrs['gen_ai.request.model']).toEqual({ stringValue: 'claude-sonnet' });
    expect(chatAttrs['gen_ai.usage.input_tokens']).toEqual({ intValue: '7' });
    expect(chatAttrs['gen_ai.usage.output_tokens']).toEqual({ intValue: '3' });
    expect(chatAttrs['cairn.raw_stop_reason']).toEqual({ stringValue: 'end_turn' });
  });

  test('ignores events that carry no span data', async () => {
    const { sink, spans } = harness();
    recordPiSpanEvent(sink, { type: 'agent_settled' });
    recordPiSpanEvent(sink, { type: 'message_end', message: { role: 'user' } });
    recordPiSpanEvent(sink, { type: 'compaction_start' });
    await sink.flush();
    expect(spans()).toEqual([]);
  });

  test('user-role message_end records no chat span', async () => {
    const { sink, spans } = harness();
    recordPiSpanEvent(sink, {
      type: 'message_end',
      message: { role: 'user', provider: 'anthropic', model: 'm', usage: { input: 1 } },
    });
    await sink.flush();
    expect(spans()).toEqual([]);
  });
});
