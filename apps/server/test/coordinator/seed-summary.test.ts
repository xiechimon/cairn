import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { SEED_SUMMARY_MAX_BATCHES, seedSummary } from '../../src/coordinator/seed-summary.js';
import { chiefMessage, chiefSummary } from '../../src/db/schema.js';
import { H, registerChiefHarness } from '../chief-harness.js';

registerChiefHarness();

const BASE = 1_700_000_000_000;

function rows(count: number, from = 0, text = (i: number) => `message ${i}`): void {
  H.s.db
    .insert(chiefMessage)
    .values(
      Array.from({ length: count }, (_, k) => {
        const i = from + k;
        return {
          id: `m${String(i).padStart(4, '0')}`,
          threadId: H.threadId,
          role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
          content: text(i),
          createdAt: BASE + i,
        };
      }),
    )
    .run();
}

const stored = () =>
  H.s.db.select().from(chiefSummary).where(eq(chiefSummary.threadId, H.threadId)).get();

const noError = () => {
  throw new Error('onError must not run');
};

describe('seed summary built on demand', () => {
  test('rows older than the seed window are folded and the cursor moves to the newest of them', async () => {
    rows(40);
    const prompts: string[] = [];
    const out = await seedSummary(
      H.s.db,
      H.threadId,
      { at: BASE + 30, rowid: 31 },
      async (prompt) => {
        prompts.push(prompt);
        return 'Decided: ship #12.';
      },
      noError,
      BASE + 1000,
    );
    expect(out).toEqual({ summary: 'Decided: ship #12.', complete: true });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('message 29');
    expect(prompts[0]).not.toContain('message 30\n');
    expect(stored()).toMatchObject({
      coveredThroughId: 'm0029',
      compactedMessages: 30,
      generation: 1,
    });
  });

  test('a second seed folds only what arrived after the stored cursor and carries the stored summary', async () => {
    rows(40);
    await seedSummary(
      H.s.db,
      H.threadId,
      { at: BASE + 30, rowid: 31 },
      async () => 'first',
      noError,
      1,
    );
    const prompts: string[] = [];
    await seedSummary(
      H.s.db,
      H.threadId,
      { at: BASE + 40, rowid: 41 },
      async (prompt) => {
        prompts.push(prompt);
        return 'second';
      },
      noError,
      2,
    );
    expect(prompts[0]).toContain('Earlier summary:\nfirst');
    expect(prompts[0]).toContain('message 30');
    expect(prompts[0]).not.toContain('message 29\n');
    expect(stored()).toMatchObject({ summary: 'second', generation: 2, coveredThroughId: 'm0039' });
  });

  test('nothing older than the window means no model call and the stored summary comes back', async () => {
    rows(10);
    const summarize = async () => {
      throw new Error('must not be called');
    };
    expect(
      await seedSummary(H.s.db, H.threadId, { at: BASE, rowid: 1 }, summarize, noError, 1),
    ).toEqual({ summary: '', complete: true });
    expect(stored()).toBeUndefined();
  });

  test('a failing summarizer keeps the stored summary and cursor and reports once', async () => {
    rows(40);
    await seedSummary(
      H.s.db,
      H.threadId,
      { at: BASE + 20, rowid: 21 },
      async () => 'kept',
      noError,
      1,
    );
    const errors: unknown[] = [];
    const out = await seedSummary(
      H.s.db,
      H.threadId,
      { at: BASE + 40, rowid: 41 },
      async () => {
        throw new Error('provider down');
      },
      (error) => errors.push(error),
      2,
    );
    expect(out).toEqual({ summary: 'kept', complete: false });
    expect(errors).toHaveLength(1);
    expect(stored()).toMatchObject({ summary: 'kept', generation: 1, coveredThroughId: 'm0019' });
  });

  test('a blank reply is not stored', async () => {
    rows(40);
    const out = await seedSummary(
      H.s.db,
      H.threadId,
      { at: BASE + 30, rowid: 31 },
      async () => '   ',
      noError,
      1,
    );
    expect(out).toEqual({ summary: '', complete: false });
    expect(stored()).toBeUndefined();
  });

  test('an empty seed window folds nothing: the newest rows are the pending turn itself', async () => {
    rows(10);
    const summarize = async () => {
      throw new Error('must not be called');
    };
    expect(await seedSummary(H.s.db, H.threadId, null, summarize, noError, 1)).toEqual({
      summary: '',
      complete: true,
    });
    expect(stored()).toBeUndefined();
  });

  test('no summarizer returns the stored summary untouched', async () => {
    rows(40);
    expect(
      await seedSummary(H.s.db, H.threadId, { at: BASE + 30, rowid: 31 }, null, noError, 1),
    ).toEqual({ summary: '', complete: true });
    expect(stored()).toBeUndefined();
  });

  test('a batch-capped backlog refuses to write and reports incomplete', async () => {
    rows(300, 0, (i) => `message ${i} ${'x'.repeat(20_000)}`);
    let calls = 0;
    const out = await seedSummary(
      H.s.db,
      H.threadId,
      { at: BASE + 300, rowid: 301 },
      async () => {
        calls += 1;
        return 'folded';
      },
      noError,
      1,
    );
    expect(calls).toBe(0);
    expect(out).toEqual({ summary: '', complete: false });
    expect(stored()).toBeUndefined();
    expect(SEED_SUMMARY_MAX_BATCHES).toBeGreaterThan(0);
  });

  test('digest rows, report rows and system rows never reach the summarizer', async () => {
    rows(4);
    H.s.db
      .insert(chiefMessage)
      .values([
        {
          id: 'chief-digest-a',
          threadId: H.threadId,
          role: 'system',
          content: 'digest-secret',
          createdAt: BASE + 10,
        },
        {
          id: 'chief-report-a',
          threadId: H.threadId,
          role: 'user',
          content: 'report-secret',
          createdAt: BASE + 11,
        },
        {
          id: 'sys-a',
          threadId: H.threadId,
          role: 'system',
          content: 'system-secret',
          createdAt: BASE + 12,
        },
      ])
      .run();
    const prompts: string[] = [];
    await seedSummary(
      H.s.db,
      H.threadId,
      null,
      async (p) => {
        prompts.push(p);
        return 'ok';
      },
      noError,
      1,
    );
    expect(prompts.join('')).not.toMatch(/digest-secret|report-secret|system-secret/);
  });

  test('a thread report in the gap reaches the summarizer as a short form with a pointer', async () => {
    H.s.db
      .insert(chiefMessage)
      .values({
        id: 'ev-1',
        threadId: H.threadId,
        role: 'user',
        content: `[wake:settle] provenance=watch:t1\n${'report line '.repeat(5_000)}REPORT-TAIL`,
        createdAt: BASE,
      })
      .run();
    const prompts: string[] = [];
    await seedSummary(
      H.s.db,
      H.threadId,
      { at: BASE + 10, rowid: 100 },
      async (p) => {
        prompts.push(p);
        return 'ok';
      },
      noError,
      1,
    );
    expect(prompts[0]).toContain('read_history ids ["ev-1"]');
    expect(prompts[0]).not.toContain('REPORT-TAIL');
  });
});
