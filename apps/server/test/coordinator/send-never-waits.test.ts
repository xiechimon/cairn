import { createAssistantMessageEventStream, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { eq, ne } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ANTHROPIC_SHORT_TTL_MS } from '../../src/coordinator/runtime/cold-slim.js';
import { SUGGEST_REPLIES_ASK } from '../../src/coordinator/runtime/suggest-replies.js';
import { chiefMessage, chiefTurnUsage, step } from '../../src/db/schema.js';
import { setCoordinatorWake } from '../../src/services/coordinator-context.js';
import { req } from '../helpers.js';
import { boot, stub, world } from './runner-world.js';

type World = Awaited<ReturnType<typeof world>>;

function olderRows(w: World, count: number): void {
  w.s.db
    .insert(chiefMessage)
    .values(
      Array.from({ length: count }, (_, i) => ({
        id: `old-${i}`,
        threadId: w.threadId,
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `earlier message ${i}.`,
        createdAt: 1_000 + i,
      })),
    )
    .run();
}

function priorTurnOn(w: World, model: string): void {
  w.s.db
    .insert(chiefTurnUsage)
    .values({
      stepId: 'prior-step',
      threadId: w.threadId,
      model,
      input: 5_000,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      contextTokens: 5_000,
      createdAt: Date.now() - ANTHROPIC_SHORT_TTL_MS - 60_000,
    })
    .run();
}

function recordedCalls(
  faux: ReturnType<typeof stub>['faux'],
  replies: { answer: string; summary: string },
) {
  const calls: { summary: boolean; text: string }[] = [];
  faux.setResponses(
    Array(8).fill((c: { messages: unknown[] }) => {
      const text = JSON.stringify(c.messages);
      const summary = text.includes('summariz');
      calls.push({ summary, text });
      return fauxAssistantMessage(summary ? replies.summary : replies.answer);
    }),
  );
  return calls;
}

describe('a Coordinator send never waits on a summary', () => {
  it('answers a model switch at once with the seed window reseeded and no summary call', async () => {
    const w = await world('resume on a new model');
    olderRows(w, 130);
    priorTurnOn(w, 'stub/previous');
    const { faux } = stub('unused');
    const calls = recordedCalls(faux, { answer: 'answered at once', summary: 'unexpected' });
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(calls.map((call) => call.summary)).not.toContain(true);
    expect(calls[0]?.text).toContain('earlier message 30.');
    expect(calls[0]?.text).toContain('earlier message 129.');
    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((r) => r.status),
    ).toEqual(['done']);
  });

  it('keeps the whole conversation after idle on the same model without summarizing', async () => {
    const w = await world('a short conversation after idle');
    olderRows(w, 90);
    priorTurnOn(w, 'stub/m');
    const { faux } = stub('unused');
    const calls = recordedCalls(faux, { answer: 'the reply', summary: 'unexpected' });
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(calls.map((call) => call.summary)).not.toContain(true);
    expect(calls[0]?.text).toContain('earlier message 0.');
  });

  it('claims a new message at once while the previous reply is still predicting quick replies', async () => {
    const w = await world('first');
    const { faux } = stub('first answer');
    let predicting = (): void => {};
    const started = new Promise<void>((resolve) => {
      predicting = resolve;
    });
    const coordinator = boot(w, faux, {
      fixedProviders: [
        {
          ...faux.provider,
          streamSimple(
            model: Parameters<typeof faux.provider.streamSimple>[0],
            context: Parameters<typeof faux.provider.streamSimple>[1],
            options: Parameters<typeof faux.provider.streamSimple>[2],
          ) {
            if (context.messages[0]?.content !== SUGGEST_REPLIES_ASK)
              return faux.provider.streamSimple(model, context, options);
            predicting();
            const stream = createAssistantMessageEventStream();
            const finish = () => {
              const message = {
                ...fauxAssistantMessage('{"replies":["stale"]}', {
                  stopReason: options?.signal?.aborted ? 'aborted' : 'stop',
                }),
                api: model.api,
                provider: model.provider,
                model: model.id,
              };
              stream.push({ type: 'done', reason: 'stop', message });
              stream.end(message);
            };
            const timer = setTimeout(finish, 5_000);
            options?.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                finish();
              },
              { once: true },
            );
            return stream;
          },
        },
      ],
    });
    setCoordinatorWake((threadId) => coordinator.wake(threadId));
    coordinator.wake(w.threadId);
    await started;

    const sentAt = Date.now();
    const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: 'second',
    });
    expect(sent.status).toBe(201);
    let claimedAt: number | null = null;
    while (claimedAt === null && Date.now() - sentAt < 4_000) {
      const second = w.s.db.select().from(step).where(ne(step.id, w.stepId)).get();
      claimedAt = second?.claimedAt ?? null;
      if (claimedAt === null) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(claimedAt).not.toBeNull();
    expect((claimedAt ?? 0) - sentAt).toBeLessThan(1_000);
    await coordinator.idle();

    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((r) => r.status),
    ).toEqual(['done', 'done']);
    expect(
      w.s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.id, `quick-replies-${w.stepId}`))
        .get(),
    ).toBeUndefined();
  }, 20_000);
});
