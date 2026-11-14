import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createCoordinatorModels,
  modelResponseTiming,
} from '../../src/coordinator/runtime/models.js';
import { SUGGEST_REPLIES_ASK } from '../../src/coordinator/runtime/suggest-replies.js';
import { chiefMessage, chiefTurnUsage } from '../../src/db/schema.js';
import {
  emitCoordinatorTurnSpans,
  flushRuntimeOtel,
  shutdownRuntimeOtel,
} from '../../src/runtime-otel.js';
import { boot, world } from './runner-world.js';

interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
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
  it.each(['thinking_delta', 'toolcall_delta', 'error', 'aborted', 'done-only'] as const)(
    'times %s responses without inventing a first token for non-streaming results',
    async (mode) => {
      const spans = captureSpans();
      const faux = fauxProvider({ provider: 'stub', models: [{ id: 'm' }] });
      const models = createCoordinatorModels([
        {
          ...faux.provider,
          streamSimple(model) {
            const stream = createAssistantMessageEventStream();
            const message = {
              ...fauxAssistantMessage('answer', {
                stopReason: mode === 'error' || mode === 'aborted' ? mode : 'stop',
              }),
              api: model.api,
              provider: model.provider,
              model: model.id,
              timestamp: Date.now(),
            };
            stream.push({ type: 'start', partial: message });
            void (async () => {
              await delay(30);
              if (mode === 'thinking_delta' || mode === 'toolcall_delta') {
                stream.push({ type: mode, contentIndex: 0, delta: 'first', partial: message });
                await delay(20);
                stream.push({ type: mode, contentIndex: 0, delta: 'later', partial: message });
              }
              if (mode === 'error' || mode === 'aborted')
                stream.push({ type: 'error', reason: mode, error: message });
              else stream.push({ type: 'done', reason: 'stop', message });
              stream.end(message);
            })();
            return stream;
          },
        },
      ]);
      await models.setApiKey('stub', 'sk-test');
      const reply = await models.models.completeSimple(models.models.getModel('stub', 'm')!, {
        messages: [],
      });
      expect(reply.stopReason).toBe(mode === 'error' || mode === 'aborted' ? mode : 'stop');
      expect(reply.content).toEqual([{ type: 'text', text: 'answer' }]);
      emitCoordinatorTurnSpans(
        { threadId: 't1', stepId: 's1', provider: 'stub', model: 'm' },
        [
          {
            kind: 'chat',
            ...modelResponseTiming(reply),
            provider: reply.provider,
            model: reply.model,
            usage: reply.usage,
            finishReason: reply.stopReason,
          },
        ],
        { CAIRN_OTEL_ENDPOINT: endpoint },
      );
      await flushRuntimeOtel();
      expect(spans).toHaveLength(1);
      const span = spans[0]!;
      const start = Number(BigInt(span.startTimeUnixNano) / 1_000_000n);
      const end = Number(BigInt(span.endTimeUnixNano) / 1_000_000n);
      expect(end - start).toBeGreaterThanOrEqual(25);
      const first = attr(span, 'langfuse.observation.completion_start_time');
      if (mode === 'thinking_delta' || mode === 'toolcall_delta') {
        expect(Date.parse(first!) - start).toBeGreaterThanOrEqual(25);
        expect(end - Date.parse(first!)).toBeGreaterThanOrEqual(15);
      } else expect(first).toBeUndefined();
      expect(span.status?.code === 2).toBe(mode === 'error');
    },
  );

  it.each([false, true])(
    'times streaming answers, suggestions and the summary prepared after them (summary fails: %s)',
    async (summaryFails) => {
      vi.stubEnv('CAIRN_OTEL_ENDPOINT', endpoint);
      const spans = captureSpans();
      const w = await world('resume on a new model');
      w.s.db
        .insert(chiefMessage)
        .values(
          Array.from({ length: 130 }, (_, i) => ({
            id: `old-${i}`,
            threadId: w.threadId,
            role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
            content: `earlier message ${i}`,
            createdAt: 1_000 + i,
          })),
        )
        .run();
      w.s.db
        .insert(chiefTurnUsage)
        .values({
          stepId: 'prior',
          threadId: w.threadId,
          model: 'stub/previous',
          input: 5_000,
          output: 10,
          cacheRead: 5_000,
          cacheWrite: 0,
          contextTokens: 5_000,
          createdAt: Date.now() - 30_000,
        })
        .run();
      const faux = fauxProvider({
        provider: 'stub',
        models: [{ id: 'm', contextWindow: 200_000 }],
      });
      const observations: { stage: string; start: number; first?: number; end?: number }[] = [];
      const coordinator = boot(w, faux, {
        fixedProviders: [
          {
            ...faux.provider,
            streamSimple(model, context) {
              const stage = JSON.stringify(context.messages).includes(
                "You are Cairn's Coordinator summarization step.",
              )
                ? 'summary'
                : context.messages[0]?.content === SUGGEST_REPLIES_ASK
                  ? 'suggestion'
                  : 'answer';
              const observed: (typeof observations)[number] = { stage, start: Date.now() };
              observations.push(observed);
              const failed = stage === 'summary' && summaryFails;
              const message = {
                ...fauxAssistantMessage(
                  stage === 'suggestion' ? '{"replies":["More"]}' : 'answer',
                  {
                    stopReason: failed ? 'error' : 'stop',
                    ...(failed ? { errorMessage: 'summary websocket failed' } : {}),
                  },
                ),
                api: model.api,
                provider: model.provider,
                model: model.id,
                timestamp: Date.now(),
              };
              const stream = createAssistantMessageEventStream();
              stream.push({ type: 'start', partial: message });
              stream.push({ type: 'text_delta', contentIndex: 0, delta: '', partial: message });
              void (async () => {
                await delay(40);
                if (!failed) {
                  observed.first = Date.now();
                  stream.push({
                    type: 'text_delta',
                    contentIndex: 0,
                    delta: 'a',
                    partial: message,
                  });
                }
                await delay(25);
                observed.end = Date.now();
                if (failed) stream.push({ type: 'error', reason: 'error', error: message });
                else stream.push({ type: 'done', reason: 'stop', message });
                stream.end(message);
              })();
              return stream;
            },
          } satisfies typeof faux.provider,
        ],
      });
      coordinator.wake(w.threadId);
      await coordinator.idle();
      await flushRuntimeOtel();
      expect(observations.map((o) => o.stage)).toEqual(['answer', 'suggestion', 'summary']);
      expect(observations[2]!.start).toBeGreaterThanOrEqual(observations[0]!.end!);
      const turn = spans.find((s) => s.name === 'coordinator turn')!;
      const summaries = spans.filter((s) => s.name === 'compaction seed-summary');
      const chats = spans.filter((s) => s.name === 'chat m');
      expect(summaries).toHaveLength(1);
      expect(chats).toHaveLength(2);
      for (const [i, span] of [...chats, ...summaries].entries()) {
        const observed = observations[i]!;
        const start = Number(BigInt(span.startTimeUnixNano) / 1_000_000n);
        const end = Number(BigInt(span.endTimeUnixNano) / 1_000_000n);
        expect(start).toBeLessThanOrEqual(observed.start + 5);
        expect(end).toBeGreaterThanOrEqual(observed.end! - 5);
        expect(end - start).toBeGreaterThanOrEqual(60);
        if (i < chats.length) {
          expect(span.traceId).toBe(turn.traceId);
          expect(span.parentSpanId).toBe(turn.spanId);
          const first = Date.parse(attr(span, 'langfuse.observation.completion_start_time') ?? '');
          expect(first).toBeGreaterThanOrEqual(observed.first! - 5);
          expect(first).toBeLessThanOrEqual(observed.end!);
          expect(first - start).toBeGreaterThanOrEqual(35);
          expect(first).toBeLessThan(end);
        }
      }
      for (const summary of summaries) expect(summary.status?.code === 2).toBe(summaryFails);
    },
  );

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
          endAt: 914,
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
    expect(BigInt(spans[0]!.endTimeUnixNano) - BigInt(spans[0]!.startTimeUnixNano)).toBe(
      913_000_000n,
    );
    expect(attr(spans[0]!, 'langfuse.observation.completion_start_time')).toBeUndefined();
    expect(spans[0]?.status?.code).toBe(2);
    expect(spans[0]?.status?.message).not.toContain('sk-abcdefghijklmnop');
  });
});
