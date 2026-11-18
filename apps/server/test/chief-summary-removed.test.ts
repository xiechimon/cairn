import { like } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { chiefMessage, step as stepTable } from '../src/db/schema.js';
import { createScheduler } from '../src/services/scheduler.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();

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

describe('no background rolling summary', () => {
  test('a scheduler tick over a long idle thread queues no digest step', async () => {
    chatter(600);
    const scheduler = createScheduler(H.s.svc, { tickMs: 60_000 });
    for (let tick = 0; tick < 20; tick++) await scheduler.tick(BASE + 10_000_000 + tick * 150_000);
    scheduler.stop();
    expect(
      H.s.db.select().from(stepTable).where(like(stepTable.buildId, 'chief-digest-%')).all(),
    ).toEqual([]);
  });
});
