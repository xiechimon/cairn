import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { and, desc, eq, like, ne, not, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { SHORT_RETENTION_MS } from '../../src/coordinator/runtime/cold-slim.js';
import { SUMMARY_LAG_ROWS } from '../../src/coordinator/seed-summary.js';
import { chiefMessage, chiefSummary, chiefTurnUsage, step } from '../../src/db/schema.js';
import { boot, stub, world } from './runner-world.js';

type World = Awaited<ReturnType<typeof world>>;

const SUMMARY_SYSTEM = "You are Cairn's Coordinator summarization step.";

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
      createdAt: Date.now() - SHORT_RETENTION_MS - 60_000,
    })
    .run();
}

function summaryCovering(w: World, rowId: string): void {
  const covered = w.s.db
    .select({ createdAt: chiefMessage.createdAt, rowid: sql<number>`rowid` })
    .from(chiefMessage)
    .where(eq(chiefMessage.id, rowId))
    .get();
  if (covered === undefined) throw new Error(`no row ${rowId}`);
  w.s.db
    .insert(chiefSummary)
    .values({
      threadId: w.threadId,
      summary: 'Stored summary of the oldest messages',
      coveredThroughId: rowId,
      coveredAt: covered.createdAt,
      coveredRowid: covered.rowid,
      compactedMessages: 20,
      generation: 1,
      updatedAt: 1,
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
      const summary = text.includes(SUMMARY_SYSTEM);
      calls.push({ summary, text });
      return fauxAssistantMessage(summary ? replies.summary : replies.answer);
    }),
  );
  return calls;
}

describe('a Coordinator send never waits on a summary', () => {
  it('answers a model switch at once from the stored summary and every row it does not cover', async () => {
    const w = await world('resume on a new model');
    olderRows(w, 130);
    summaryCovering(w, 'old-19');
    priorTurnOn(w, 'stub/previous');
    const { faux } = stub('unused');
    const calls = recordedCalls(faux, { answer: 'answered at once', summary: 'unexpected' });
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(calls.map((call) => call.summary)).not.toContain(true);
    expect(calls[0]?.text).toContain('Stored summary of the oldest messages');
    expect(calls[0]?.text).toContain('earlier message 20.');
    expect(calls[0]?.text).toContain('earlier message 129.');
    expect(calls[0]?.text).not.toContain('earlier message 19.');
    expect(
      w.s.db.select().from(chiefSummary).where(eq(chiefSummary.threadId, w.threadId)).get()
        ?.generation,
    ).toBe(1);
    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((r) => r.status),
    ).toEqual(['done']);
  });

  it('prepares the summary after the reply once rows fall outside the seed window', async () => {
    const w = await world('a reply that leaves old rows unsummarized');
    olderRows(w, 100 + SUMMARY_LAG_ROWS + 10);
    priorTurnOn(w, 'stub/m');
    const { faux } = stub('unused');
    const calls = recordedCalls(faux, { answer: 'the reply', summary: 'Prepared summary' });
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(calls[0]?.summary).toBe(false);
    expect(calls.filter((call) => call.summary)).toHaveLength(1);
    expect(calls.find((call) => call.summary)?.text).toContain('earlier message 0.');
    const newestFirst = w.s.db
      .select({ id: chiefMessage.id })
      .from(chiefMessage)
      .where(
        and(
          eq(chiefMessage.threadId, w.threadId),
          ne(chiefMessage.role, 'system'),
          not(like(chiefMessage.id, 'chief-digest-%')),
          not(like(chiefMessage.id, 'chief-report-%')),
        ),
      )
      .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
      .all();
    const stored = w.s.db
      .select()
      .from(chiefSummary)
      .where(eq(chiefSummary.threadId, w.threadId))
      .get();
    expect(stored?.summary).toBe('Prepared summary');
    expect(stored?.coveredThroughId).toBe(newestFirst[100]?.id);
  });

  it('keeps the whole conversation after idle on the same model without summarizing', async () => {
    const w = await world('a short conversation after idle');
    olderRows(w, 100);
    priorTurnOn(w, 'stub/m');
    const { faux } = stub('unused');
    const calls = recordedCalls(faux, { answer: 'the reply', summary: 'unexpected' });
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(calls.map((call) => call.summary)).not.toContain(true);
    expect(calls[0]?.text).toContain('earlier message 0.');
    expect(
      w.s.db.select().from(chiefSummary).where(eq(chiefSummary.threadId, w.threadId)).get(),
    ).toBeUndefined();
  });
});
