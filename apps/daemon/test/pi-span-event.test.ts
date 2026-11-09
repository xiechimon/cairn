import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseOtlpTarget, stepOtelContext } from '@cairn/shared/otel';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { flushDaemonOtel, PiStepSpanSink, shutdownDaemonOtel } from '../src/backend/otel.js';
import { type AgentSessionEventLike, recordPiSpanEvent } from '../src/backend/pi.js';

const captured: { body: { resourceSpans: { scopeSpans: { spans: unknown[] }[] }[] } }[] = [];
let server: Server | undefined;
let endpoint = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      captured.push({ body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/public/otel`;
});

afterAll(async () => {
  await shutdownDaemonOtel();
  server?.close();
});

function harness() {
  captured.splice(0);
  const target = parseOtlpTarget({ CAIRN_OTEL_ENDPOINT: endpoint })!;
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
    await flushDaemonOtel();
    const sent = spans();
    expect(sent).toHaveLength(2);
    const tool = sent.find((s) => s.name.startsWith('execute_tool'))!;
    expect(tool.parentSpanId).toBe('68de601387c7a961');
    const toolAttrs = Object.fromEntries(tool.attributes.map((a) => [a.key, a.value]));
    expect(toolAttrs['gen_ai.tool.call.id']).toEqual({ stringValue: 'call-9' });
    const chat = sent.find((s) => s.name.startsWith('chat'))!;
    const chatAttrs = Object.fromEntries(chat.attributes.map((a) => [a.key, a.value]));
    expect(chatAttrs['gen_ai.request.model']).toEqual({ stringValue: 'claude-sonnet' });
    expect(chatAttrs['gen_ai.usage.input_tokens']).toEqual({ intValue: 7 });
    expect(chatAttrs['gen_ai.usage.output_tokens']).toEqual({ intValue: 3 });
    expect(chatAttrs['cairn.raw_stop_reason']).toEqual({ stringValue: 'end_turn' });
  });

  test('ignores events that carry no span data', async () => {
    const { sink, spans } = harness();
    recordPiSpanEvent(sink, { type: 'agent_settled' });
    recordPiSpanEvent(sink, { type: 'message_end', message: { role: 'user' } });
    recordPiSpanEvent(sink, { type: 'compaction_start' });
    await sink.flush();
    await flushDaemonOtel();
    expect(spans()).toEqual([]);
  });

  test('user-role message_end records no chat span', async () => {
    const { sink, spans } = harness();
    recordPiSpanEvent(sink, {
      type: 'message_end',
      message: { role: 'user', provider: 'anthropic', model: 'm', usage: { input: 1 } },
    });
    await sink.flush();
    await flushDaemonOtel();
    expect(spans()).toEqual([]);
  });
});
