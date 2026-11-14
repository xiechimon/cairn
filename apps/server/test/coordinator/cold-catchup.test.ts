import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { SHORT_RETENTION_MS } from '../../src/coordinator/runtime/cold-slim.js';
import {
  chiefMessage,
  chiefSummary,
  chiefTurnUsage,
  coordinatorConversation,
  step,
} from '../../src/db/schema.js';
import { boot, stub, world } from './runner-world.js';

function olderRows(w: Awaited<ReturnType<typeof world>>, count: number): void {
  w.s.db
    .insert(chiefMessage)
    .values(
      Array.from({ length: count }, (_, i) => ({
        id: `old-${i}`,
        threadId: w.threadId,
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `earlier message ${i}`,
        createdAt: 1_000 + i,
      })),
    )
    .run();
}

describe('cold catchUpColdSummary on lag', () => {
  it('keeps the whole conversation when the same model resumes after idle', async () => {
    const w = await world('resume after idle on the same model');
    olderRows(w, 40);
    w.s.db
      .insert(chiefTurnUsage)
      .values({
        stepId: 'prior-step-idle',
        threadId: w.threadId,
        model: 'stub/m',
        input: 5_000,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        contextTokens: 5_000,
        createdAt: Date.now() - SHORT_RETENTION_MS - 60_000,
      })
      .run();

    const { faux } = stub('unused');
    faux.setResponses([fauxAssistantMessage('answered with the full conversation')]);
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(
      w.s.db.select().from(chiefSummary).where(eq(chiefSummary.threadId, w.threadId)).get(),
    ).toBeUndefined();
    const conversation = w.s.db
      .select()
      .from(coordinatorConversation)
      .where(eq(coordinatorConversation.threadId, w.threadId))
      .get();
    expect(conversation?.lastColdSlimStepId ?? null).toBeNull();
    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((r) => r.status),
    ).toEqual(['done']);
  });

  it('stays warm when catch-up fails and the summary still lags the cold window', async () => {
    const w = await world('resume on a new model without summary');
    olderRows(w, 40);
    w.s.db
      .insert(chiefTurnUsage)
      .values({
        stepId: 'prior-step-fail',
        threadId: w.threadId,
        model: 'stub/previous',
        input: 5_000,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        contextTokens: 5_000,
        createdAt: Date.now() - SHORT_RETENTION_MS - 60_000,
      })
      .run();

    const { faux } = stub('unused');
    faux.setResponses([
      fauxAssistantMessage('   '),
      fauxAssistantMessage('answered on warm residual'),
    ]);
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(
      w.s.db.select().from(chiefSummary).where(eq(chiefSummary.threadId, w.threadId)).get(),
    ).toBeUndefined();
    const conversation = w.s.db
      .select()
      .from(coordinatorConversation)
      .where(eq(coordinatorConversation.threadId, w.threadId))
      .get();
    expect(conversation?.lastColdSlimStepId ?? null).toBeNull();
    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((r) => r.status),
    ).toEqual(['done']);
  });

  it('runs seedSummary→foldSummary and records lastColdSlim markers', async () => {
    const w = await world('resume on a new model');
    olderRows(w, 130);
    const priorCovered = w.s.db
      .select({
        id: chiefMessage.id,
        createdAt: chiefMessage.createdAt,
        rowid: sql<number>`rowid`,
      })
      .from(chiefMessage)
      .where(eq(chiefMessage.id, 'old-9'))
      .get();
    expect(priorCovered).toBeDefined();
    w.s.db
      .insert(chiefSummary)
      .values({
        threadId: w.threadId,
        summary: 'Stale prior summary',
        coveredThroughId: 'old-9',
        coveredAt: priorCovered!.createdAt,
        coveredRowid: priorCovered!.rowid,
        compactedMessages: 10,
        generation: 1,
        updatedAt: 1,
      })
      .run();
    w.s.db
      .insert(chiefTurnUsage)
      .values({
        stepId: 'prior-step',
        threadId: w.threadId,
        model: 'stub/previous',
        input: 5_000,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        contextTokens: 5_000,
        createdAt: Date.now() - SHORT_RETENTION_MS - 60_000,
      })
      .run();

    const { faux } = stub('unused');
    faux.setResponses([
      fauxAssistantMessage('Folded cold catch-up summary'),
      fauxAssistantMessage('answered after cold slim'),
    ]);
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();

    const stored = w.s.db
      .select()
      .from(chiefSummary)
      .where(eq(chiefSummary.threadId, w.threadId))
      .get();
    expect(stored?.summary).toBe('Folded cold catch-up summary');
    expect(stored?.generation).toBe(2);
    expect(stored?.compactedMessages).toBeGreaterThan(10);

    const conversation = w.s.db
      .select()
      .from(coordinatorConversation)
      .where(eq(coordinatorConversation.threadId, w.threadId))
      .get();
    expect(conversation?.lastColdSlimStepId).toBe(w.stepId);
    expect(conversation?.lastColdSlimAt).toEqual(expect.any(Number));

    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((r) => r.status),
    ).toEqual(['done']);
  });

  it('cold-slims on model mismatch after a context-less prior turn (claude-code → Pi)', async () => {
    const w = await world('resume after claude-code');
    olderRows(w, 130);
    const priorCovered = w.s.db
      .select({
        id: chiefMessage.id,
        createdAt: chiefMessage.createdAt,
        rowid: sql<number>`rowid`,
      })
      .from(chiefMessage)
      .where(eq(chiefMessage.id, 'old-9'))
      .get();
    expect(priorCovered).toBeDefined();
    w.s.db
      .insert(chiefSummary)
      .values({
        threadId: w.threadId,
        summary: 'Stale prior summary',
        coveredThroughId: 'old-9',
        coveredAt: priorCovered!.createdAt,
        coveredRowid: priorCovered!.rowid,
        compactedMessages: 10,
        generation: 1,
        updatedAt: 1,
      })
      .run();
    w.s.db
      .insert(chiefTurnUsage)
      .values({
        stepId: 'prior-claude-code',
        threadId: w.threadId,
        model: 'claude-code/claude-haiku-5-5',
        input: 9_000,
        output: 40,
        cacheRead: 40_000,
        cacheWrite: 0,
        contextTokens: null,
        createdAt: Date.now() - 30_000,
      })
      .run();

    const { faux } = stub('unused');
    faux.setResponses([
      fauxAssistantMessage('Folded after model-mismatch cold'),
      fauxAssistantMessage('answered on Pi after claude-code'),
    ]);
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();

    const conversation = w.s.db
      .select()
      .from(coordinatorConversation)
      .where(eq(coordinatorConversation.threadId, w.threadId))
      .get();
    expect(conversation?.lastColdSlimStepId).toBe(w.stepId);
    expect(conversation?.lastColdSlimAt).toEqual(expect.any(Number));
    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((r) => r.status),
    ).toEqual(['done']);
  });
});
