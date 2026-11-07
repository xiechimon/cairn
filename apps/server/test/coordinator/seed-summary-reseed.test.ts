import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { chiefMessage, chiefSummary, step } from '../../src/db/schema.js';
import { boot, KEY, stub, world } from './runner-world.js';

function olderRows(w: Awaited<ReturnType<typeof world>>, count: number): void {
  w.s.db
    .insert(chiefMessage)
    .values(
      Array.from({ length: count }, (_, i) => ({
        id: `old-${i}`,
        threadId: w.threadId,
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `earlier message ${i}`,
        createdAt: 1000 + i,
      })),
    )
    .run();
}

describe('Coordinator reseed builds its summary on demand', () => {
  it('a failing summary call is logged without the key and the turn still runs', async () => {
    const w = await world('go on');
    olderRows(w, 130);
    const { faux } = stub('unused');
    faux.setResponses([
      fauxAssistantMessage([], {
        stopReason: 'error',
        errorMessage: `401 incorrect API key provided: ${KEY}`,
      }),
      fauxAssistantMessage('answered'),
    ]);
    const lines: string[] = [];
    const sink = (obj: object, message: string) => lines.push(`${JSON.stringify(obj)} ${message}`);
    const coordinator = boot(w, faux, { logger: { info: sink, warn: sink, error: sink } });

    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(lines.join('\n')).toContain('seed summary failed');
    expect(lines.join('\n')).not.toContain(KEY);
    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((r) => r.status),
    ).toEqual(['done']);
    expect(
      w.s.db.select().from(chiefSummary).where(eq(chiefSummary.threadId, w.threadId)).get(),
    ).toBeUndefined();
  });

  it('a working summary call is stored with the cursor at the newest row it covered', async () => {
    const w = await world('go on');
    olderRows(w, 130);
    const { faux } = stub('unused');
    faux.setResponses([
      fauxAssistantMessage('Decided: ship it.'),
      fauxAssistantMessage('answered'),
    ]);
    const coordinator = boot(w, faux);

    coordinator.wake(w.threadId);
    await coordinator.idle();

    const stored = w.s.db
      .select()
      .from(chiefSummary)
      .where(eq(chiefSummary.threadId, w.threadId))
      .get();
    expect(stored).toMatchObject({
      summary: 'Decided: ship it.',
      coveredThroughId: 'old-29',
      compactedMessages: 30,
    });
    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((r) => r.status),
    ).toEqual(['done']);
  });

  it('keeps the step heartbeat alive while a slow summary call runs', async () => {
    const w = await world('go on');
    olderRows(w, 130);
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 200_000 }],
      tokensPerSecond: 20,
    });
    faux.setResponses([
      fauxAssistantMessage('slow summary '.repeat(20)),
      fauxAssistantMessage('answered'),
    ]);
    const coordinator = boot(w, faux, { heartbeatMs: 50 });
    coordinator.wake(w.threadId);
    const beats = new Set<number>();
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const row = w.s.db.select().from(step).where(eq(step.id, w.stepId)).get();
      if (row?.status === 'done') break;
      if (row?.status === 'claimed' && row.lastHeartbeatAt !== null) beats.add(row.lastHeartbeatAt);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await coordinator.idle();
    expect(beats.size).toBeGreaterThan(2);
    expect(w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.status).toBe('done');
  }, 15_000);
});
