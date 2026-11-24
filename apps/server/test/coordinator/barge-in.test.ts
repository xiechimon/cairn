import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Model,
  type Context as ModelContext,
  type Provider,
} from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { SUGGEST_REPLIES_ASK } from '../../src/coordinator/runtime/suggest-replies.js';
import { chiefMessage, step } from '../../src/db/schema.js';
import { COORDINATOR_SYSTEM_PROMPT } from '../../src/services/chief.js';
import { setCoordinatorWake } from '../../src/services/coordinator-context.js';
import { req } from '../helpers.js';
import { boot, world } from './runner-world.js';

interface RecordedRequest {
  index: number;
  receivedAt: number;
  messages: ModelContext['messages'];
  abortedAt: number | null;
}

type Handler = (
  ctx: ModelContext,
  model: Model<never>,
  options: { signal?: AbortSignal } | undefined,
  rec: RecordedRequest,
) => ReturnType<Provider['streamSimple']>;

function makeStreamingProvider(handlers: Handler[]) {
  const base = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  const requests: RecordedRequest[] = [];
  let callIndex = 0;
  const provider: Provider = {
    ...base.provider,
    streamSimple(model, context, options) {
      if (context.messages[0]?.content === SUGGEST_REPLIES_ASK) {
        const stream = createAssistantMessageEventStream();
        const message: AssistantMessage = {
          ...fauxAssistantMessage('{"replies":[]}'),
          api: model.api,
          provider: model.provider,
          model: model.id,
        };
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end(message);
        return stream;
      }
      const index = callIndex++;
      const rec: RecordedRequest = {
        index,
        receivedAt: Date.now(),
        messages: structuredClone(context.messages),
        abortedAt: null,
      };
      requests.push(rec);
      const handler = handlers[index];
      if (handler === undefined) {
        throw new Error(`Unexpected model request #${index}`);
      }
      return handler(context, model as Model<never>, options, rec);
    },
  };
  return { base, provider, requests };
}

function slowTextStream(
  model: Model<never>,
  chunks: string[],
  delayMs: number,
  options: { signal?: AbortSignal } | undefined,
  rec: RecordedRequest,
  onFirstChunk?: () => void,
) {
  const stream = createAssistantMessageEventStream();
  let accumulated = '';
  const buildMessage = (stopReason: AssistantMessage['stopReason']): AssistantMessage => ({
    ...fauxAssistantMessage(accumulated, { stopReason }),
    api: model.api,
    provider: model.provider,
    model: model.id,
  });
  const timers: ReturnType<typeof setTimeout>[] = [];
  let finished = false;
  const finishAbort = () => {
    if (finished) return;
    finished = true;
    rec.abortedAt = Date.now();
    for (const t of timers) clearTimeout(t);
    const msg = buildMessage('aborted');
    stream.push({ type: 'error', reason: 'aborted', error: msg });
    stream.end(msg);
  };
  if (options?.signal?.aborted) {
    queueMicrotask(finishAbort);
    return stream;
  }
  options?.signal?.addEventListener('abort', finishAbort, { once: true });
  chunks.forEach((chunk, i) => {
    timers.push(
      setTimeout(
        () => {
          if (finished) return;
          if (i === 0) {
            const opening = buildMessage('stop');
            stream.push({ type: 'start', partial: opening });
            stream.push({ type: 'text_start', contentIndex: 0, partial: opening });
          }
          accumulated += chunk;
          const partial = buildMessage('stop');
          stream.push({ type: 'text_delta', contentIndex: 0, delta: chunk, partial });
          if (i === 0) onFirstChunk?.();
          if (i === chunks.length - 1) {
            timers.push(
              setTimeout(() => {
                if (finished) return;
                finished = true;
                const finalMsg = buildMessage('stop');
                stream.push({
                  type: 'text_end',
                  contentIndex: 0,
                  content: accumulated,
                  partial: finalMsg,
                });
                stream.push({ type: 'done', reason: 'stop', message: finalMsg });
                stream.end(finalMsg);
              }, delayMs),
            );
          }
        },
        i === 0 ? 15 : 15 + i * delayMs,
      ),
    );
  });
  return stream;
}

function instantStream(model: Model<never>, message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  const stamped: AssistantMessage = {
    ...message,
    api: model.api,
    provider: model.provider,
    model: model.id,
  };
  stream.push({ type: 'done', reason: stamped.stopReason as 'stop', message: stamped });
  stream.end(stamped);
  return stream;
}

function assistantTexts(db: Awaited<ReturnType<typeof world>>['s']['db'], threadId: string) {
  return db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, threadId))
    .all()
    .filter((row) => row.role === 'assistant')
    .flatMap((row) => {
      const content = row.content;
      if (typeof content === 'string') {
        try {
          const parsed = JSON.parse(content) as { kind?: unknown };
          if (typeof parsed === 'object' && parsed !== null && typeof parsed.kind === 'string') {
            return [];
          }
        } catch {}
        return [content];
      }
      if (!Array.isArray(content)) return [];
      return content.flatMap((b: { type?: string; text?: string }) =>
        b.type === 'text' && typeof b.text === 'string' ? [b.text] : [],
      );
    });
}

describe('Coordinator instant barge-in interrupt', () => {
  it('aborts in-flight generation immediately on correction, keeps prompt cache prefix byte-identical, and persists exactly one reply', async () => {
    const w = await world('今天是星期几');
    let onChunk1 = () => {};
    const firstChunkSent = new Promise<void>((resolve) => {
      onChunk1 = resolve;
    });

    const { base, provider, requests } = makeStreamingProvider([
      (_ctx, model, options, rec) =>
        slowTextStream(
          model,
          ['今天是星期二，', '这是不该说完的旧回答。'],
          1_500,
          options,
          rec,
          onChunk1,
        ),
      (ctx, model) => {
        const users = ctx.messages.filter((m) => m.role === 'user');
        expect(users).toHaveLength(2);
        return instantStream(model, fauxAssistantMessage('明天是星期三。'));
      },
    ]);

    const sseEvents: Record<string, unknown>[] = [];
    const unsubscribe = w.s.convHub.subscribe(w.threadId, {
      nextSeq: () => sseEvents.length + 1,
      send: async (payload) => {
        sseEvents.push(payload as Record<string, unknown>);
      },
    });

    const coordinator = boot(w, base, {
      fixedProviders: [provider],
      stopPollMs: 60_000,
    });
    setCoordinatorWake((threadId) => coordinator.wake(threadId));
    coordinator.wake(w.threadId);

    await firstChunkSent;
    await new Promise((r) => setTimeout(r, 140));

    const tSend2 = Date.now();
    const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: '说错了，明天是星期几',
    });
    expect(sent.status).toBe(201);

    await coordinator.idle();
    unsubscribe();

    expect(requests).toHaveLength(2);
    const req1 = requests[0]!;
    const req2 = requests[1]!;

    expect(req1.abortedAt).not.toBeNull();
    expect((req1.abortedAt ?? 0) - tSend2).toBeLessThan(500);
    expect(req2.receivedAt - tSend2).toBeLessThan(500);

    expect(req2.messages.slice(0, req1.messages.length)).toEqual(req1.messages);
    expect(req2.messages).toHaveLength(req1.messages.length + 1);
    expect(req2.messages.at(-1)?.role).toBe('user');
    expect(JSON.stringify(req2.messages.at(-1)?.content)).toContain('说错了，明天是星期几');

    expect(
      sseEvents.some(
        (ev) =>
          ev.type === 'activity' &&
          (ev.activity as { resetLive?: boolean } | undefined)?.resetLive === true,
      ),
    ).toBe(true);

    expect(assistantTexts(w.s.db, w.threadId)).toEqual(['明天是星期三。']);
    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((r) => r.status),
    ).toEqual(['done']);
  }, 15_000);

  it('answers two separate rapid questions in one combined reply after immediate barge-in', async () => {
    const w = await world('1+1等于几？');
    let onChunk1 = () => {};
    const firstChunkSent = new Promise<void>((resolve) => {
      onChunk1 = resolve;
    });

    const { base, provider, requests } = makeStreamingProvider([
      (_ctx, model, options, rec) =>
        slowTextStream(model, ['1+1 等于 2，', '慢速输出中...'], 1_500, options, rec, onChunk1),
      (ctx, model) => {
        const text = JSON.stringify(ctx.messages.filter((m) => m.role === 'user'));
        expect(text).toContain('1+1等于几？');
        expect(text).toContain('另外2+2等于几？');
        return instantStream(model, fauxAssistantMessage('1+1 等于 2，2+2 等于 4。'));
      },
    ]);

    const coordinator = boot(w, base, {
      fixedProviders: [provider],
      stopPollMs: 60_000,
    });
    setCoordinatorWake((threadId) => coordinator.wake(threadId));
    coordinator.wake(w.threadId);
    await firstChunkSent;

    const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: '另外2+2等于几？',
    });
    expect(sent.status).toBe(201);
    await coordinator.idle();

    expect(requests).toHaveLength(2);
    expect(requests[0]!.abortedAt).not.toBeNull();
    expect(requests[1]!.messages.slice(0, requests[0]!.messages.length)).toEqual(
      requests[0]!.messages,
    );
    expect(assistantTexts(w.s.db, w.threadId)).toEqual(['1+1 等于 2，2+2 等于 4。']);
  }, 15_000);

  it('handles 3 rapid messages in sequence and commits only the final reply', async () => {
    const w = await world('第一句');
    let onChunk1 = () => {};
    const firstChunkSent = new Promise<void>((resolve) => {
      onChunk1 = resolve;
    });
    let onChunk2 = () => {};
    const secondChunkSent = new Promise<void>((resolve) => {
      onChunk2 = resolve;
    });

    const { base, provider, requests } = makeStreamingProvider([
      (_ctx, model, options, rec) =>
        slowTextStream(model, ['回答一...'], 1_500, options, rec, onChunk1),
      (_ctx, model, options, rec) =>
        slowTextStream(model, ['回答二...'], 1_500, options, rec, onChunk2),
      (ctx, model) => {
        const users = ctx.messages.filter((m) => m.role === 'user');
        expect(users).toHaveLength(3);
        return instantStream(model, fauxAssistantMessage('最终只回复第三句。'));
      },
    ]);

    const coordinator = boot(w, base, {
      fixedProviders: [provider],
      stopPollMs: 60_000,
    });
    setCoordinatorWake((threadId) => coordinator.wake(threadId));
    coordinator.wake(w.threadId);

    await firstChunkSent;
    expect(
      (
        await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
          content: '第二句',
        })
      ).status,
    ).toBe(201);

    await secondChunkSent;
    expect(
      (
        await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
          content: '第三句',
        })
      ).status,
    ).toBe(201);

    await coordinator.idle();
    expect(requests).toHaveLength(3);
    expect(requests[0]!.abortedAt).not.toBeNull();
    expect(requests[1]!.abortedAt).not.toBeNull();
    expect(requests[2]!.messages.slice(0, requests[1]!.messages.length)).toEqual(
      requests[1]!.messages,
    );
    expect(assistantTexts(w.s.db, w.threadId)).toEqual(['最终只回复第三句。']);
  }, 15_000);

  it('does not abort an active tool round and steers cleanly at the post-tool boundary, then allows barge-in on round 2 text', async () => {
    const w = await world('先查一下问题');
    let onRound2Chunk = () => {};
    const round2Streaming = new Promise<void>((resolve) => {
      onRound2Chunk = resolve;
    });

    const { base, provider, requests } = makeStreamingProvider([
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage(
            [
              fauxToolCall('ask_user', {
                questions: [
                  { header: 'Confirm', question: 'Proceed?', options: [{ label: 'Yes' }] },
                ],
              }),
            ],
            { stopReason: 'toolUse' },
          ),
        ),
      (_ctx, model, options, rec) =>
        slowTextStream(
          model,
          ['收到你在提问期间的补充，正在慢慢写...'],
          1_500,
          options,
          rec,
          onRound2Chunk,
        ),
      (ctx, model) => {
        const text = JSON.stringify(ctx.messages);
        expect(text).toContain('工具期间补充');
        expect(text).toContain('第二轮中途改主意');
        return instantStream(model, fauxAssistantMessage('按最新主意回复。'));
      },
    ]);

    const coordinator = boot(w, base, {
      fixedProviders: [provider],
      stopPollMs: 60_000,
    });
    setCoordinatorWake((threadId) => coordinator.wake(threadId));
    coordinator.wake(w.threadId);

    const question = () =>
      w.s.db
        .select()
        .from(chiefMessage)
        .all()
        .find((row) => JSON.stringify(row.content).includes('ask_user_question'));
    const deadline = Date.now() + 8_000;
    while (question() === undefined && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(question()).toBeDefined();

    expect(
      (
        await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
          content: '工具期间补充',
        })
      ).status,
    ).toBe(201);

    await new Promise((r) => setTimeout(r, 150));
    expect(requests).toHaveLength(1);

    expect(
      (
        await req(
          w.s.app,
          'POST',
          `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/${question()!.id}/answer`,
          { answers: [{ header: 'Confirm', choices: ['Yes'] }] },
        )
      ).status,
    ).toBe(200);

    await round2Streaming;
    const tBarge2 = Date.now();
    expect(
      (
        await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
          content: '第二轮中途改主意',
        })
      ).status,
    ).toBe(201);

    await coordinator.idle();
    expect(requests).toHaveLength(3);
    expect(requests[1]!.abortedAt).not.toBeNull();
    expect((requests[1]!.abortedAt ?? 0) - tBarge2).toBeLessThan(500);
    expect(requests[2]!.messages.slice(0, requests[1]!.messages.length)).toEqual(
      requests[1]!.messages,
    );
    expect(assistantTexts(w.s.db, w.threadId)).toEqual(['按最新主意回复。']);
  }, 15_000);

  it('stops immediately on Esc without resurrecting an earlier barge-in aborted partial', async () => {
    const w = await world('今天是星期几');
    let onChunk1 = () => {};
    const firstChunkSent = new Promise<void>((resolve) => {
      onChunk1 = resolve;
    });
    let onReq2Started = () => {};
    const req2Started = new Promise<void>((resolve) => {
      onReq2Started = resolve;
    });

    const { base, provider } = makeStreamingProvider([
      (_ctx, model, options, rec) =>
        slowTextStream(model, ['旧回答草稿不应该出现'], 2_000, options, rec, onChunk1),
      (_ctx, model, options, rec) => {
        onReq2Started();
        return slowTextStream(model, ['永远来不及发出的第二轮'], 5_000, options, rec);
      },
    ]);

    const coordinator = boot(w, base, {
      fixedProviders: [provider],
      stopPollMs: 60_000,
    });
    setCoordinatorWake((threadId) => coordinator.wake(threadId));
    coordinator.wake(w.threadId);

    await firstChunkSent;
    await new Promise((r) => setTimeout(r, 140));
    expect(
      (
        await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
          content: '说错了，明天是星期几',
        })
      ).status,
    ).toBe(201);

    await req2Started;
    const tStop = Date.now();
    expect(
      (await req(w.s.app, 'POST', `/api/teams/${w.teamId}/chief/threads/${w.threadId}/stop`))
        .status,
    ).toBe(200);

    await coordinator.idle();
    expect(Date.now() - tStop).toBeLessThan(800);
    expect(w.s.db.select().from(step).get()?.status).toBe('stopped');
    expect(assistantTexts(w.s.db, w.threadId)).toEqual([]);
  }, 15_000);

  it('instructs the Coordinator prompt to treat consecutive user messages as correction vs separate questions', () => {
    expect(COORDINATOR_SYSTEM_PROMPT).toMatch(/consecutive user messages/i);
    expect(COORDINATOR_SYSTEM_PROMPT).toMatch(/corrects or replaces/i);
  });
});
