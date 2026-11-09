import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitCoordinatorTurnSpans } from '../../src/runtime-otel.js';
import { boot, world } from './runner-world.js';

interface Span {
  traceId: string;
  parentSpanId?: string;
  name: string;
  status?: { code: number; message: string };
  attributes: { key: string; value: { stringValue?: string; intValue?: string } }[];
}

function captureSpans(): Span[] {
  const spans: Span[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        resourceSpans: { scopeSpans: { spans: Span[] }[] }[];
      };
      for (const resource of body.resourceSpans) {
        for (const scope of resource.scopeSpans) spans.push(...scope.spans);
      }
      return new Response('{}', { status: 200 });
    }),
  );
  return spans;
}

const attr = (span: Span, key: string) =>
  span.attributes.find((a) => a.key === key)?.value.stringValue;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('in-server Coordinator telemetry', () => {
  it('exports the turn, one chat span per model call and one span per tool call under the thread session', async () => {
    vi.stubEnv('CAIRN_OTEL_ENDPOINT', 'http://127.0.0.1:4318/v1/traces');
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
    expect(chats).toHaveLength(2);
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
      { CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:4318/v1/traces' },
    );
    await vi.waitFor(() => expect(spans).toHaveLength(1));
    expect(spans[0]?.status?.code).toBe(2);
    expect(spans[0]?.status?.message).not.toContain('sk-abcdefghijklmnop');
  });
});
