import { chiefDigestThreadId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { chief, chiefMessage, chiefSummary, step as stepTable } from '../src/db/schema.js';
import { finishChiefDigest } from '../src/services/chief-digest.js';
import { setCoordinatorServerContextEnabled } from '../src/services/coordinator-context.js';
import { createScheduler } from '../src/services/scheduler.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();
beforeEach(() => setCoordinatorServerContextEnabled(true));
afterEach(() => setCoordinatorServerContextEnabled(false));

const BASE = 1_700_000_000_000;

function chatter(count: number): void {
  H.s.db
    .insert(chiefMessage)
    .values(
      Array.from({ length: count }, (_, i) => ({
        id: `m${String(i).padStart(4, '0')}`,
        threadId: H.threadId,
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `message ${i}`,
        createdAt: BASE + i,
      })),
    )
    .run();
}

function digestThreadSteps() {
  return H.s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, chiefDigestThreadId(H.chiefId)))
    .all();
}

describe('no background rolling summary', () => {
  test('a scheduler tick over a long idle thread queues no digest or summary step', async () => {
    chatter(600);
    const scheduler = createScheduler(H.s.svc, { tickMs: 60_000 });
    for (let tick = 0; tick < 20; tick++) await scheduler.tick(BASE + 10_000_000 + tick * 150_000);
    scheduler.stop();
    expect(
      digestThreadSteps().filter((row) => (row.prompt ?? '').includes('Summary thread=')),
    ).toEqual([]);
    expect(H.s.db.select().from(chiefSummary).all()).toEqual([]);
  });

  test('a summary step queued before the upgrade fails harmlessly and writes no summary', () => {
    chatter(10);
    const chiefRow = H.s.db.select().from(chief).where(eq(chief.id, H.chiefId)).get()!;
    const digestThread = chiefDigestThreadId(chiefRow.id);
    H.s.db
      .insert(stepTable)
      .values({
        id: 'leftover-summary',
        buildId: digestThread,
        kind: 'chief',
        status: 'claimed',
        prompt: `earlier\nSummary thread=${H.threadId} through=m0009 count=10`,
        createdAt: BASE,
      } as never)
      .run();
    const row = H.s.db.select().from(stepTable).where(eq(stepTable.id, 'leftover-summary')).get()!;
    finishChiefDigest(H.s.svc, row, { status: 'success' } as never, BASE + 1);
    expect(
      H.s.db.select().from(stepTable).where(eq(stepTable.id, 'leftover-summary')).get()?.status,
    ).toBe('failed');
    expect(H.s.db.select().from(chiefSummary).all()).toEqual([]);
  });
});
