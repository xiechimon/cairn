import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  emitCoordinatorTurnSpans,
  flushRuntimeOtel,
  shutdownRuntimeOtel,
} from '../../src/runtime-otel.js';
import { boot, world } from './runner-world.js';

interface Span {
  traceId: string;
  parentSpanId?: string;
  name: string;
  status?: { code: number; message: string };
  attributes: { key: string; value: { stringValue?: string; intValue?: string } }[];
}

const received: Span[] = [];
let server: Server | undefined;
let endpoint = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        resourceSpans: { scopeSpans: { spans: Span[] }[] }[];
      };
      for (const resource of body.resourceSpans) {
        for (const scope of resource.scopeSpans) received.push(...scope.spans);
      }
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/traces`;
});

afterAll(async () => {
  await shutdownRuntimeOtel();
  server?.close();
});

function captureSpans(): Span[] {
  received.splice(0);
  return received;
}

const attr = (span: Span, key: string) =>
  span.attributes.find((a) => a.key === key)?.value.stringValue;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('in-server Coordinator telemetry', () => {
  it('exports the turn, one chat span per model call and one span per tool call under the thread session', async () => {
    vi.stubEnv('CAIRN_OTEL_ENDPOINT', endpoint);
    const spans = captureSpans();
    const w = await world('what is open?');
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 200_000 }],
      tokensPerSecond: 1e9,
    });
    faux.setResponses(
      Array(4).fill((c: { messages: { role: string }[] }) =>
        c.messages.at(-1)?.role === 'toolResult'
          ? fauxAssistantMessage('nothing open')
          : fauxAssistantMessage([fauxToolCall('todos', {})], { stopReason: 'toolUse' }),
      ),
    );
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    await vi.waitFor(() => expect(spans.some((s) => s.name === 'coordinator turn')).toBe(true));

    const turn = spans.find((s) => s.name === 'coordinator turn');
    const chats = spans.filter((s) => s.name === 'chat m');
    const tools = spans.filter((s) => s.name === 'execute_tool todos');
    expect(attr(turn as Span, 'session.id')).toBe(w.threadId);
    expect(chats).toHaveLength(3);
    expect(tools).toHaveLength(1);
    for (const child of [...chats, ...tools]) {
      expect(child.traceId).toBe(turn?.traceId);
      expect(child.parentSpanId).toBeDefined();
    }
    expect(attr(chats[0] as Span, 'gen_ai.provider.name')).toBe('stub');
    expect(chats[0]?.attributes.some((a) => a.key === 'gen_ai.usage.input_tokens')).toBe(true);
  });

  it('exports nothing and does not fail the turn when no OTLP endpoint is set', async () => {
    const spans = captureSpans();
    const w = await world('hello');
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 200_000 }],
      tokensPerSecond: 1e9,
    });
    faux.setResponses([fauxAssistantMessage('hi')]);
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    await flushRuntimeOtel();
    expect(spans).toEqual([]);
  });

  it('marks a failed model call as an error with the reason redacted', async () => {
    const spans = captureSpans();
    emitCoordinatorTurnSpans(
      { threadId: 't1', stepId: 's1', provider: 'stub', model: 'm' },
      [
        {
          kind: 'chat',
          at: 1,
          provider: 'stub',
          model: 'm',
          finishReason: 'error',
          usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 },
          errorMessage: 'provider said no for sk-abcdefghijklmnopqrstuvwxyz123456',
        },
      ],
      { CAIRN_OTEL_ENDPOINT: endpoint },
    );
    await flushRuntimeOtel();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status?.code).toBe(2);
    expect(spans[0]?.status?.message).not.toContain('sk-abcdefghijklmnop');
  });
});
