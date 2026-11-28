import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
} from '@earendil-works/pi-ai';
import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compactionFailureCounts,
  resetCompactionFailureCounts,
} from '../../src/coordinator/runtime/failure-report.js';
import {
  chiefMessage,
  chiefThread,
  chiefTurnUsage,
  coordinatorInput,
  provider,
  routingRule,
  step,
} from '../../src/db/schema.js';
import * as runtimeOtel from '../../src/runtime-otel.js';
import { req } from '../helpers.js';
import { boot, type World, world } from './runner-world.js';

const MINUTE = 60_000;
const IDLE_AFTER_MS = 11 * MINUTE;
const CONTEXT_WINDOW = 200_000;
const PAD = '背景说明'.repeat(320);

interface TriggerFacts {
  now: number;
  idleAfterMs: number;
  lastActivityAt: number | null;
  contextTokens: number | null;
  contextWindow: number;
  warm: boolean;
  cacheExpiresAt: number | null;
}

function facts(overrides: Partial<TriggerFacts> = {}): TriggerFacts {
  return {
    now: 1_000_000,
    idleAfterMs: IDLE_AFTER_MS,
    lastActivityAt: 0,
    contextTokens: 90_000,
    contextWindow: CONTEXT_WINDOW,
    warm: false,
    cacheExpiresAt: null,
    ...overrides,
  };
}

async function policy() {
  return import('../../src/coordinator/runtime/idle-compact.js');
}

function longHistory(w: World, count = 80) {
  const base = Date.now() - IDLE_AFTER_MS - MINUTE;
  w.s.db
    .insert(chiefMessage)
    .values(
      Array.from({ length: count }, (_, i) => ({
        id: `old-${i}`,
        threadId: w.threadId,
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `earlier message ${i}. ${PAD}`,
        createdAt: base + i,
      })),
    )
    .run();
}

function backdateEverything(w: World) {
  const base = Date.now() - IDLE_AFTER_MS - MINUTE;
  w.s.db.run(
    sql`update chief_message set createdAt = ${base} + rowid where threadId = ${w.threadId}`,
  );
  w.s.db
    .update(chiefThread)
    .set({ memoryFlushedAt: Date.now() })
    .where(eq(chiefThread.id, w.threadId))
    .run();
  w.s.db
    .update(coordinatorInput)
    .set({ state: 'released' })
    .where(and(eq(coordinatorInput.threadId, w.threadId), eq(coordinatorInput.state, 'pending')))
    .run();
  w.s.db.update(step).set({ status: 'done' }).where(eq(step.buildId, w.threadId)).run();
}

/** The last measured turn the sweep decides from, set immediately before a tick. */
function forceUsage(w: World, contextTokens = 90_000, model = 'stub/m', createdAt = Date.now()) {
  w.s.db.delete(chiefTurnUsage).where(eq(chiefTurnUsage.threadId, w.threadId)).run();
  w.s.db
    .insert(chiefTurnUsage)
    .values({
      stepId: w.stepId,
      threadId: w.threadId,
      model,
      input: 0,
      output: 10,
      cacheRead: 90_000,
      cacheWrite: 0,
      contextTokens,
      contextWindow: CONTEXT_WINDOW,
      createdAt,
    })
    .run();
}

function isSummaryAsk(content: unknown): boolean {
  return JSON.stringify(content ?? '').includes('Write its rolling summary now.');
}

function isFoldAsk(content: unknown): boolean {
  return JSON.stringify(content ?? '').includes('Merge the earlier summary');
}

function summaryCalls(calls: { messages: { content: unknown }[] }[]): number {
  return calls.filter((call) => isSummaryAsk(call.messages.at(-1)?.content)).length;
}

function recordingFaux() {
  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: CONTEXT_WINDOW }],
    tokensPerSecond: 1e9,
  });
  const calls: { messages: { content: unknown }[]; options: unknown }[] = [];
  faux.setResponses(
    Array(40).fill((c: { messages: { content: unknown }[] }, o: unknown) => {
      calls.push({ messages: c.messages, options: o });
      return fauxAssistantMessage(
        isSummaryAsk(c.messages.at(-1)?.content) ? 'rolling summary' : 'answered',
      );
    }),
  );
  return { faux, calls };
}

/**
 * A thread whose conversation has run one real turn (so its model is configured) and then sat
 * idle for longer than the window with a long history and a large measured turn.
 */
async function idleLongThread(recorded = recordingFaux()) {
  const w = await world('long project');
  longHistory(w);
  const coordinator = boot(w, recorded.faux);
  coordinator.wake(w.threadId);
  await coordinator.idle();
  recorded.calls.length = 0;
  forceUsage(w);
  backdateEverything(w);
  return { w, coordinator, faux: recorded.faux, calls: recorded.calls };
}

async function until(check: () => boolean, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !check()) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(check()).toBe(true);
}

beforeEach(() => resetCompactionFailureCounts());

describe('idle compaction policy', () => {
  it('compacts at half the turn threshold, never below the reserve a summary needs', async () => {
    const { idleCompactAt } = await policy();
    expect(idleCompactAt(1_000_000)).toBe(75_000);
    expect(idleCompactAt(200_000)).toBe(75_000);
    expect(idleCompactAt(131_072)).toBe(40_960);
    expect(idleCompactAt(100_000)).toBe(32_768);
    expect(idleCompactAt(60_000)).toBeGreaterThan(24_000);
  });

  it('idles a long conversation but leaves a short one alone', async () => {
    const { compactionTrigger } = await policy();
    expect(compactionTrigger(facts({ contextTokens: 90_000, lastActivityAt: 0 }))).toBe('idle');
    expect(compactionTrigger(facts({ contextTokens: 5_000, lastActivityAt: 0 }))).toBeNull();
    expect(compactionTrigger(facts({ contextTokens: 90_000, lastActivityAt: 999_999 }))).toBeNull();
    expect(compactionTrigger(facts({ contextTokens: null }))).toBeNull();
    expect(compactionTrigger(facts({ contextTokens: 0 }))).toBeNull();
  });

  it('fires just before a warm cache expires, never after it or without a known TTL', async () => {
    const { compactionTrigger } = await policy();
    const expiring = facts({ contextTokens: 90_000, lastActivityAt: 999_999 });
    expect(
      compactionTrigger({ ...expiring, warm: true, cacheExpiresAt: expiring.now + 30_000 }),
    ).toBe('cache-expiry');
    expect(
      compactionTrigger({ ...expiring, warm: true, cacheExpiresAt: expiring.now + 10 * MINUTE }),
    ).toBeNull();
    expect(
      compactionTrigger({ ...expiring, warm: true, cacheExpiresAt: expiring.now - 1 }),
    ).toBeNull();
    expect(compactionTrigger({ ...expiring, warm: true, cacheExpiresAt: null })).toBeNull();
    expect(
      compactionTrigger({ ...expiring, warm: false, cacheExpiresAt: expiring.now + 60_000 }),
    ).toBeNull();
  });

  it('lets the ten-minute idle rule win over a one-hour cache and the expiry rule win over a five-minute one', async () => {
    const { compactionTrigger } = await policy();
    const expiring = facts({ contextTokens: 90_000, lastActivityAt: 999_999 });
    expect(
      compactionTrigger({ ...expiring, warm: true, cacheExpiresAt: expiring.now + 30_000 }),
    ).toBe('cache-expiry');
    const oneHourLeft = { warm: true, cacheExpiresAt: expiring.now + 55 * MINUTE };
    expect(compactionTrigger({ ...expiring, ...oneHourLeft })).toBeNull();
    expect(compactionTrigger({ ...expiring, ...oneHourLeft, lastActivityAt: 0 })).toBe('idle');
    const fiveMinutesLeft = { warm: true, cacheExpiresAt: expiring.now + 4 * MINUTE };
    expect(compactionTrigger({ ...expiring, ...fiveMinutesLeft, lastActivityAt: 0 })).toBe('idle');
  });

  it('reads a prompt cache only when the summary runs on the last turn model', async () => {
    const { reusesPromptCache } = await policy();
    expect(reusesPromptCache('anthropic/claude-sonnet-5-5', 'anthropic/claude-sonnet-5-5')).toBe(
      true,
    );
    expect(reusesPromptCache('anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5')).toBe(
      false,
    );
    expect(reusesPromptCache('openai/gpt-6.2', 'anthropic/claude-sonnet-5-5')).toBe(false);
  });

  it('refuses a summary that does not fit beside the context it reads', async () => {
    const { summaryOutputBudget } = await policy();
    expect(summaryOutputBudget(200_000, 200_000, 16_384)).toBeNull();
    expect(summaryOutputBudget(190_000, 200_000, 16_384)).toBeNull();
    expect(summaryOutputBudget(90_000, 200_000, 16_384)).toBe(16_384);
    expect(summaryOutputBudget(90_000, 200_000, 200)).toBe(1_024);
  });

  it('asks for the summary after the live context, so the provider reads that prefix', async () => {
    const { contextSummaryRequest } = await import('../../src/coordinator/runtime/compaction.js');
    const messages = [
      { role: 'user' as const, content: 'ship #72', timestamp: 1 },
      { role: 'user' as const, content: 'and then?', timestamp: 2 },
    ];
    const request = contextSummaryRequest(messages, 3);
    expect(request).toHaveLength(3);
    expect(request.slice(0, 2)).toEqual(messages);
    const last = request.at(-1);
    expect(last?.role).toBe('user');
    expect(JSON.stringify(last?.content)).toContain('Write its rolling summary now.');
    expect(JSON.stringify(last?.content)).toContain('Reply with the summary text only');
  });
});

describe('idle compaction in the running Coordinator', () => {
  it('compacts a long conversation left idle on its own, reading the warm context, and drops the summarized history from the next turn', async () => {
    const { w, coordinator, calls } = await idleLongThread();
    const miss = vi.spyOn(runtimeOtel, 'emitCompactionSpan');
    try {
      coordinator.tick();
      await coordinator.idle();

      expect(summaryCalls(calls)).toBe(1);
      const summaryCall = calls.find((call) => isSummaryAsk(call.messages.at(-1)?.content));
      expect(JSON.stringify(summaryCall?.messages)).toContain('earlier message 0.');
      const options = summaryCall?.options as { cacheRetention?: string; maxTokens?: number };
      expect(options.cacheRetention).toBeUndefined();
      expect(options.maxTokens).toBeGreaterThan(1_024);
      expect(compactionFailureCounts()['idle-compaction']).toBeUndefined();
      expect(
        miss.mock.calls.some(
          ([span]) =>
            span.stage === 'idle-compaction' &&
            span.errorClass === undefined &&
            span.count === undefined,
        ),
      ).toBe(true);

      calls.length = 0;
      const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
        content: 'what is left?',
      });
      expect(sent.status).toBe(201);
      coordinator.wake(w.threadId);
      await coordinator.idle();
      const turn = calls.find((call) => !isSummaryAsk(call.messages.at(-1)?.content));
      const turnText = JSON.stringify(turn?.messages);
      expect(turnText).toContain('rolling summary');
      expect(turnText).not.toContain('earlier message 0.');
      expect(turnText).not.toContain('earlier message 79.');
    } finally {
      miss.mockRestore();
    }
  }, 60_000);

  it('compacts through the transcript instead of the live context once a known cache has expired', async () => {
    const w = await world('long project');
    longHistory(w);
    const recorded = recordingFaux();
    const coordinator = boot(w, recorded.faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    recorded.calls.length = 0;
    backdateEverything(w);
    forceUsage(w, 90_000, 'anthropic/claude-sonnet-5-5', Date.now() - 3 * 60 * MINUTE);
    coordinator.tick();
    await coordinator.idle();

    expect(summaryCalls(recorded.calls)).toBe(0);
    expect(recorded.calls.some((call) => isFoldAsk(call.messages.at(-1)?.content))).toBe(true);
    expect(compactionFailureCounts()['idle-compaction']).toBeUndefined();
  }, 60_000);

  it('leaves a conversation below the gate completely alone', async () => {
    const w = await world('short chat');
    longHistory(w, 10);
    const recorded = recordingFaux();
    const coordinator = boot(w, recorded.faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    recorded.calls.length = 0;
    forceUsage(w, 5_000);
    backdateEverything(w);
    const miss = vi.spyOn(runtimeOtel, 'emitCompactionSpan');
    try {
      coordinator.tick();
      await coordinator.idle();
      expect(summaryCalls(recorded.calls)).toBe(0);
      expect(miss.mock.calls.some(([span]) => span.stage === 'idle-compaction')).toBe(false);
    } finally {
      miss.mockRestore();
    }
  }, 30_000);

  it('sends nothing when the team has no usable summary route', async () => {
    const w = await world('long project');
    longHistory(w);
    const recorded = recordingFaux();
    const coordinator = boot(w, recorded.faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    recorded.calls.length = 0;
    backdateEverything(w);
    forceUsage(w);
    w.s.db.delete(routingRule).where(eq(routingRule.teamId, w.teamId)).run();
    w.s.db
      .update(provider)
      .set({ apiKeyCipher: 'synthetic-broken-cipher' })
      .where(eq(provider.providerId, 'stub'))
      .run();
    coordinator.tick();
    await coordinator.idle();
    expect(recorded.calls).toEqual([]);
  }, 30_000);

  it('keeps a single attempt for a turn size with nothing summarizable', async () => {
    const w = await world('long project');
    const recorded = recordingFaux();
    const coordinator = boot(w, recorded.faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    recorded.calls.length = 0;
    backdateEverything(w);
    forceUsage(w);
    coordinator.tick();
    await coordinator.idle();
    expect(summaryCalls(recorded.calls)).toBe(1);
    expect(compactionFailureCounts()['idle-compaction']).toBeUndefined();
    coordinator.tick();
    await coordinator.idle();
    expect(summaryCalls(recorded.calls)).toBe(1);
  }, 30_000);

  it('compacts nothing while the thread is archived, has a live step or ran on a backend runtime', async () => {
    const w = await world('long project');
    longHistory(w);
    const recorded = recordingFaux();
    const coordinator = boot(w, recorded.faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    recorded.calls.length = 0;
    forceUsage(w);
    backdateEverything(w);
    const archive = (at: number | null) =>
      w.s.db
        .update(chiefThread)
        .set({ archivedAt: at })
        .where(eq(chiefThread.id, w.threadId))
        .run();
    const status = (next: string) =>
      w.s.db
        .update(step)
        .set({ status: next as 'pending' })
        .where(eq(step.buildId, w.threadId))
        .run();

    const tickWith = async (model = 'stub/m') => {
      backdateEverything(w);
      forceUsage(w, 90_000, model);
      coordinator.tick();
      await coordinator.idle();
    };

    archive(Date.now());
    await tickWith();
    expect(summaryCalls(recorded.calls)).toBe(0);
    archive(null);

    backdateEverything(w);
    forceUsage(w);
    status('pending');
    coordinator.tick();
    await coordinator.idle();
    expect(summaryCalls(recorded.calls)).toBe(0);
    status('done');

    await tickWith('devin/swe-2-1-medium');
    expect(summaryCalls(recorded.calls)).toBe(0);

    await tickWith();
    expect(summaryCalls(recorded.calls)).toBe(1);
  }, 60_000);

  it('admits a user message at once while the summary is still being written and places the summary afterwards', async () => {
    const w = await world('long project');
    longHistory(w);
    const base = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: CONTEXT_WINDOW }],
      tokensPerSecond: 1e9,
    });
    const seen: { summary: boolean; ask: string; body: string }[] = [];
    base.setResponses(
      Array(40).fill((c: { messages: { content: unknown }[] }) => {
        const ask = String(c.messages.at(-1)?.content);
        const summary = isSummaryAsk(c.messages.at(-1)?.content);
        seen.push({ summary, ask, body: JSON.stringify(c.messages) });
        if (summary) return fauxAssistantMessage('rolling summary');
        return fauxAssistantMessage(ask.includes('are you there?') ? 'second answer' : 'answered');
      }),
    );
    let releaseSummary = (): void => {};
    const summaryGate = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    let summaryStarted = (): void => {};
    const started = new Promise<void>((resolve) => {
      summaryStarted = resolve;
    });
    let summaryRequests = 0;
    const provider: typeof base.provider = {
      ...base.provider,
      streamSimple(model, context, options) {
        if (!isSummaryAsk(context.messages.at(-1)?.content)) {
          return base.provider.streamSimple(model, context, options);
        }
        summaryRequests += 1;
        summaryStarted();
        const stream = createAssistantMessageEventStream();
        void summaryGate.then(() => {
          const message = {
            ...fauxAssistantMessage('rolling summary'),
            api: model.api,
            provider: model.provider,
            model: model.id,
          };
          stream.push({ type: 'done', reason: 'stop', message });
          stream.end(message);
        });
        return stream;
      },
    };
    const coordinator = boot(w, { provider });
    try {
      coordinator.wake(w.threadId);
      await coordinator.idle();
      forceUsage(w);
      backdateEverything(w);

      coordinator.tick();
      await started;
      expect(summaryRequests).toBe(1);

      const sentAt = Date.now();
      const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
        content: 'are you there?',
      });
      expect(sent.status).toBe(201);
      coordinator.wake(w.threadId);
      await until(
        () => seen.some((call) => String(call.ask ?? '').includes('are you there?')),
        10_000,
      );
      expect(Date.now() - sentAt).toBeLessThan(5_000);

      releaseSummary();
      await coordinator.idle();
      expect(compactionFailureCounts()['idle-compaction']).toBeUndefined();
      expect(
        w.s.db
          .select()
          .from(chiefMessage)
          .all()
          .some(
            (row) =>
              row.role === 'assistant' && JSON.stringify(row.content).includes('second answer'),
          ),
      ).toBe(true);
      expect(summaryRequests).toBe(1);
      expect(seen.some((call) => isFoldAsk(call.ask))).toBe(true);

      const next = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
        content: 'what next?',
      });
      expect(next.status).toBe(201);
      coordinator.wake(w.threadId);
      await coordinator.idle();
      const last = seen.filter((call) => call.ask.includes('what next?')).at(-1);
      expect(last?.body).toContain('are you there?');
      expect(last?.body).toContain('second answer');
    } finally {
      releaseSummary();
    }
  }, 60_000);

  it('leaves nothing half-written when the server shuts down mid-summary and compacts once after restart', async () => {
    const w = await world('long project');
    longHistory(w);
    const base = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: CONTEXT_WINDOW }],
      tokensPerSecond: 1e9,
    });
    let summaryStarted = (): void => {};
    const started = new Promise<void>((resolve) => {
      summaryStarted = resolve;
    });
    let aborted = false;
    const provider: typeof base.provider = {
      ...base.provider,
      streamSimple(model, context, options) {
        if (!isSummaryAsk(context.messages.at(-1)?.content)) {
          return base.provider.streamSimple(model, context, options);
        }
        summaryStarted();
        const stream = createAssistantMessageEventStream();
        const finish = () => {
          const message = {
            ...fauxAssistantMessage('', {
              stopReason: 'aborted',
              errorMessage: 'Request was aborted',
            }),
            api: model.api,
            provider: model.provider,
            model: model.id,
          };
          stream.push({ type: 'error', reason: 'aborted', error: message });
          stream.end(message);
        };
        options?.signal?.addEventListener(
          'abort',
          () => {
            aborted = true;
            finish();
          },
          { once: true },
        );
        return stream;
      },
    };
    base.setResponses(Array(40).fill(fauxAssistantMessage('answered')));
    const coordinator = boot(w, { provider });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    forceUsage(w);
    backdateEverything(w);
    coordinator.tick();
    await started;

    const closedAt = Date.now();
    await coordinator.close();
    expect(aborted).toBe(true);
    expect(Date.now() - closedAt).toBeLessThan(5_000);

    resetCompactionFailureCounts();
    const restarted = recordingFaux();
    const second = boot(w, restarted.faux);
    second.tick();
    await second.idle();
    expect(summaryCalls(restarted.calls)).toBe(1);
    expect(compactionFailureCounts()['idle-compaction']).toBeUndefined();
  }, 60_000);

  it('does not compact the same turn size again after the server restarts', async () => {
    const first = await idleLongThread();
    first.coordinator.tick();
    await first.coordinator.idle();
    expect(summaryCalls(first.calls)).toBe(1);

    const restarted = recordingFaux();
    const second = boot(first.w, restarted.faux);
    second.tick();
    await second.idle();
    expect(summaryCalls(restarted.calls)).toBe(0);
    expect(compactionFailureCounts()['idle-compaction']).toBeUndefined();
  }, 60_000);

  it('backs off after a failed summary instead of retrying every tick', async () => {
    const w = await world('long project');
    longHistory(w);
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: CONTEXT_WINDOW }],
      tokensPerSecond: 1e9,
    });
    let attempts = 0;
    faux.setResponses(
      Array(40).fill((c: { messages: { content: unknown }[] }) => {
        if (isSummaryAsk(c.messages.at(-1)?.content)) {
          attempts += 1;
          return fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'summary down' });
        }
        return fauxAssistantMessage('answered');
      }),
    );
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    forceUsage(w);
    backdateEverything(w);

    coordinator.tick();
    await coordinator.idle();
    expect(attempts).toBe(1);
    expect(compactionFailureCounts()['idle-compaction']).toBe(1);

    coordinator.tick();
    await coordinator.idle();
    expect(attempts).toBe(1);
  }, 60_000);
});
