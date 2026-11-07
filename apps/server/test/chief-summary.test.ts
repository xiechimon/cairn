import { chiefDigestThreadId } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { chiefMessage, chiefSummary, step as stepTable } from '../src/db/schema.js';
import { planChiefDigests } from '../src/services/chief-digest.js';
import {
  finishChiefSummary,
  isChiefSummaryStep,
  planChiefSummaries,
  SUMMARY_BATCH_MAX_MESSAGES,
  SUMMARY_MAX_CHARS,
  SUMMARY_WINDOW_MESSAGES,
  uncompactedCount,
} from '../src/services/chief-summary.js';
import { setCoordinatorServerContextEnabled } from '../src/services/coordinator-context.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();
beforeEach(() => setCoordinatorServerContextEnabled(true));
afterEach(() => setCoordinatorServerContextEnabled(false));

const BASE = 1_700_000_000_000;
const NOW = BASE + 10_000_000;

function seed(count: number, from = 0): void {
  H.s.db
    .insert(chiefMessage)
    .values(
      Array.from({ length: count }, (_, k) => {
        const i = from + k;
        return {
          id: `m${String(i).padStart(4, '0')}`,
          threadId: H.threadId,
          role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
          content: `message ${i}`,
          createdAt: BASE + i,
        };
      }),
    )
    .run();
}

function summarySteps() {
  return H.s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, chiefDigestThreadId(H.chiefId)))
    .all()
    .filter(isChiefSummaryStep);
}

function reply(text: string): void {
  H.s.db
    .insert(chiefMessage)
    .values({
      id: `reply-${Math.random()}`,
      threadId: chiefDigestThreadId(H.chiefId),
      role: 'assistant',
      content: text,
      createdAt: NOW,
    })
    .run();
}

function finishLast(status: 'success' | 'failed', text?: string) {
  const row = summarySteps().at(-1)!;
  if (text !== undefined) reply(text);
  finishChiefSummary(H.s.svc, row, { status } as never, NOW + 1);
  return H.s.db.select().from(stepTable).where(eq(stepTable.id, row.id)).get()!;
}

function summaryRow() {
  return H.s.db.select().from(chiefSummary).where(eq(chiefSummary.threadId, H.threadId)).get();
}

describe('rolling Coordinator summary (D70 C2)', () => {
  test('99 uncompacted messages queue nothing; 100 queue one summary of the oldest 50', () => {
    seed(99);
    planChiefSummaries(H.s.svc, NOW);
    expect(summarySteps()).toHaveLength(0);
    seed(1, 99);
    planChiefSummaries(H.s.svc, NOW);
    const [queued] = summarySteps();
    expect(queued?.prompt).toContain('message 0\n');
    expect(queued?.prompt).toContain('message 49');
    expect(queued?.prompt).not.toContain('message 50');
    expect(queued?.prompt).toContain('Earlier summary:\n(none yet)');
    expect(queued?.prompt?.endsWith(`Summary thread=${H.threadId} through=m0049 count=50`)).toBe(
      true,
    );
  });

  test('a finished summary is stored, the cursor moves past the batch, and the next batch carries it', () => {
    seed(100);
    planChiefSummaries(H.s.svc, NOW);
    expect(finishLast('success', 'Decided: ship #12.').status).toBe('done');
    expect(summaryRow()).toMatchObject({
      summary: 'Decided: ship #12.',
      coveredThroughId: 'm0049',
      compactedMessages: 50,
      generation: 1,
    });
    expect(uncompactedCount(H.s.db, H.threadId)).toBe(50);
    planChiefSummaries(H.s.svc, NOW + 2);
    expect(summarySteps()).toHaveLength(1);
    seed(50, 100);
    planChiefSummaries(H.s.svc, NOW + 2);
    const second = summarySteps().at(-1)!;
    expect(second.prompt).toContain('Earlier summary:\nDecided: ship #12.');
    expect(second.prompt).toContain('message 50');
    expect(second.prompt).not.toContain('message 49\n');
  });

  test('a failed or empty summary keeps the cursor and waits out the retry delay', () => {
    seed(100);
    planChiefSummaries(H.s.svc, NOW);
    expect(finishLast('failed').status).toBe('failed');
    expect(summaryRow()).toBeUndefined();
    planChiefSummaries(H.s.svc, NOW + 2);
    expect(summarySteps()).toHaveLength(1);
    planChiefSummaries(H.s.svc, NOW + 2 + 16 * 60_000);
    expect(summarySteps()).toHaveLength(2);
    expect(finishLast('success', '   ').status).toBe('failed');
    expect(summaryRow()).toBeUndefined();
  });

  test('no new messages since the last summary queue nothing, however often the planner ticks', () => {
    seed(100);
    planChiefSummaries(H.s.svc, NOW);
    finishLast('success', 'Covered the first 50.');
    for (let tick = 1; tick <= 20; tick++) planChiefSummaries(H.s.svc, NOW + tick * 150_000);
    expect(summarySteps()).toHaveLength(1);
  });

  test('a summary and its own digest-thread output do not count as new messages', () => {
    seed(100);
    planChiefSummaries(H.s.svc, NOW);
    finishLast('success', 'Covered the first 50.');
    const before = uncompactedCount(H.s.db, H.threadId);
    reply('another assistant line on the digest thread');
    H.s.db
      .insert(chiefMessage)
      .values({
        id: 'chief-digest-own-output',
        threadId: H.threadId,
        role: 'system',
        content: '{}',
        createdAt: NOW + 5,
      })
      .run();
    expect(uncompactedCount(H.s.db, H.threadId)).toBe(before);
    planChiefSummaries(H.s.svc, NOW + 10 * 60_000);
    expect(summarySteps()).toHaveLength(1);
  });

  test('a failed summary stays backed off across every tick inside the retry delay', () => {
    seed(100);
    planChiefSummaries(H.s.svc, NOW);
    finishLast('failed');
    for (let tick = 1; tick <= 5; tick++) planChiefSummaries(H.s.svc, NOW + tick * 150_000);
    expect(summarySteps()).toHaveLength(1);
  });

  test('at most one summary is in flight while a large backlog waits', () => {
    seed(1000);
    for (let tick = 0; tick < 10; tick++) planChiefSummaries(H.s.svc, NOW + tick * 150_000);
    expect(summarySteps()).toHaveLength(1);
  });

  test('a large backlog is drained in batches of up to the batch cap, always leaving the live window', () => {
    seed(1000);
    planChiefSummaries(H.s.svc, NOW);
    const [first] = summarySteps();
    expect(first?.prompt?.endsWith(`count=${SUMMARY_BATCH_MAX_MESSAGES}`)).toBe(true);
    finishLast('success', 'Covered the first batch.');
    expect(uncompactedCount(H.s.db, H.threadId)).toBe(1000 - SUMMARY_BATCH_MAX_MESSAGES);
    let remaining = uncompactedCount(H.s.db, H.threadId);
    let tick = 1;
    while (remaining >= SUMMARY_WINDOW_MESSAGES * 2) {
      planChiefSummaries(H.s.svc, NOW + tick * 2);
      finishLast('success', `Covered batch ${tick}.`);
      remaining = uncompactedCount(H.s.db, H.threadId);
      tick += 1;
    }
    expect(remaining).toBe(SUMMARY_WINDOW_MESSAGES);
    expect(tick).toBeLessThanOrEqual(4);
    planChiefSummaries(H.s.svc, NOW + 100);
    expect(summarySteps()).toHaveLength(tick);
  });

  test('a batch over the transcript budget stops early and the cursor covers only what was sent', () => {
    H.s.db
      .insert(chiefMessage)
      .values([
        {
          id: 'big0',
          threadId: H.threadId,
          role: 'user',
          content: 'a'.repeat(30_000),
          createdAt: BASE,
        },
        {
          id: 'big1',
          threadId: H.threadId,
          role: 'assistant',
          content: 'b'.repeat(15_000),
          createdAt: BASE + 1,
        },
      ])
      .run();
    seed(98, 2);
    planChiefSummaries(H.s.svc, NOW);
    const queued = summarySteps()[0]!;
    expect(queued.prompt?.endsWith(`through=big0 count=1`)).toBe(true);
    expect(queued.prompt).not.toContain('bbbb');
    finishLast('success', 'Covered big0.');
    expect(summaryRow()).toMatchObject({ coveredThroughId: 'big0', compactedMessages: 1 });
    expect(uncompactedCount(H.s.db, H.threadId)).toBe(99);
  });

  test('a single message larger than the budget is cut alone and still advances by one', () => {
    H.s.db
      .insert(chiefMessage)
      .values({
        id: 'huge',
        threadId: H.threadId,
        role: 'user',
        content: 'z'.repeat(3_890_000),
        createdAt: BASE,
      })
      .run();
    seed(99, 1);
    planChiefSummaries(H.s.svc, NOW);
    const queued = summarySteps()[0]!;
    expect(queued.prompt).toContain('(cut for length)');
    expect(queued.prompt!.length).toBeLessThan(45_000);
    expect(queued.prompt?.endsWith('through=huge count=1')).toBe(true);
  });

  test('the summary is capped and a fenced reply is unwrapped', () => {
    seed(100);
    planChiefSummaries(H.s.svc, NOW);
    finishLast('success', `\`\`\`\n${'x'.repeat(SUMMARY_MAX_CHARS + 500)}\n\`\`\``);
    expect(summaryRow()?.summary).toBe('x'.repeat(SUMMARY_MAX_CHARS));
  });

  test('it never takes a user turn: nothing is queued while a Coordinator turn waits', () => {
    seed(120);
    H.s.db
      .insert(stepTable)
      .values({
        id: 'user-turn',
        buildId: H.threadId,
        kind: 'chief',
        status: 'pending',
        prompt: 'hi',
        createdAt: NOW,
      })
      .run();
    planChiefSummaries(H.s.svc, NOW);
    expect(summarySteps()).toHaveLength(0);
  });

  test('digest and report rows, and system rows, are not counted as messages', () => {
    seed(99);
    H.s.db
      .insert(chiefMessage)
      .values([
        {
          id: 'chief-digest-x',
          threadId: H.threadId,
          role: 'system',
          content: '{}',
          createdAt: BASE + 500,
        },
        { id: 'sys-1', threadId: H.threadId, role: 'system', content: 'x', createdAt: BASE + 501 },
      ])
      .run();
    expect(uncompactedCount(H.s.db, H.threadId)).toBe(99);
  });

  test('under the flag the 40k-character threshold digest no longer folds the conversation', () => {
    H.s.db
      .insert(chiefMessage)
      .values({
        id: 'long',
        threadId: H.threadId,
        role: 'user',
        content: 'y'.repeat(45_000),
        createdAt: NOW - 1000,
      })
      .run();
    planChiefDigests(H.s.svc, NOW);
    expect(
      H.s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, chiefDigestThreadId(H.chiefId)))
        .all(),
    ).toEqual([]);
    setCoordinatorServerContextEnabled(false);
    planChiefDigests(H.s.svc, NOW);
    expect(
      H.s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, chiefDigestThreadId(H.chiefId)))
        .all(),
    ).toHaveLength(1);
  });

  test('flag off: nothing is queued', () => {
    setCoordinatorServerContextEnabled(false);
    seed(150);
    planChiefSummaries(H.s.svc, NOW);
    expect(summarySteps()).toHaveLength(0);
    expect(
      H.s.db
        .select()
        .from(stepTable)
        .where(and(eq(stepTable.buildId, chiefDigestThreadId(H.chiefId))))
        .all(),
    ).toEqual([]);
  });
});
