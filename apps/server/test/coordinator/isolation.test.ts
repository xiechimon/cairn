import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { chief, chiefMessage, chiefThread, coordinatorLease, step } from '../../src/db/schema.js';
import { boot, stub, world } from './runner-world.js';

const QUESTION = {
  questions: [
    { header: 'Pick', question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] },
  ],
};

async function until(check: () => boolean, ms = 8_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('Coordinator per-thread isolation', () => {
  it('attributes concurrent tool calls to their own thread steps', async () => {
    const w = await world('first thread');
    const thread = w.s.db.select().from(chiefThread).get();
    const message = w.s.db.select().from(chiefMessage).get();
    const origin = w.s.db.select().from(step).get();
    if (!thread || !message || !origin) throw new Error('seed rows missing');
    const chiefRow = w.s.db.select().from(chief).get();
    if (!chiefRow) throw new Error('seed rows missing');
    w.s.db
      .insert(chief)
      .values({ ...chiefRow, id: 'chief-two' })
      .run();
    w.s.db
      .insert(chiefThread)
      .values({ ...thread, id: 'chief-second', chiefId: 'chief-two' })
      .run();
    w.s.db
      .insert(chiefMessage)
      .values({ ...message, id: 'msg-second', threadId: 'chief-second' })
      .run();
    w.s.db
      .insert(step)
      .values({ ...origin, id: 'msg-second', buildId: 'chief-second' })
      .run();
    const { faux } = stub('unused');
    faux.setResponses(
      Array(2)
        .fill(0)
        .map(
          () => () =>
            fauxAssistantMessage([fauxToolCall('ask_user', QUESTION)], { stopReason: 'toolUse' }),
        ),
    );
    const coordinator = boot(w, faux);
    const threads = w.s.db.select().from(step).all();
    for (const row of threads) coordinator.wake(row.buildId);
    const questions = () =>
      w.s.db
        .select()
        .from(chiefMessage)
        .all()
        .filter((m) => JSON.stringify(m.content).includes('ask_user_question'));
    await until(() => questions().length === 2, 3000).catch((e) => {
      console.log(
        'DBG',
        JSON.stringify(
          w.s.db
            .select()
            .from(step)
            .all()
            .map((r) => [r.buildId, r.status, r.holdReason]),
        ),
        questions().length,
      );
      throw e;
    });

    for (const row of threads) {
      const own = questions().filter((m) => m.threadId === row.buildId);
      expect(own).toHaveLength(1);
    }
    const askers = w.s.db.select().from(step).where(eq(step.status, 'claimed')).all();
    expect(new Set(askers.map((r) => r.buildId)).size).toBe(2);
  });

  it('keeps the store lease while the harness is open and drops it once idle-closed', async () => {
    const w = await world('lease me');
    const { faux } = stub('ok');
    const coordinator = boot(w, faux, { idleCloseMs: 0 });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    expect(w.s.db.select().from(coordinatorLease).get()?.owner).not.toBeNull();

    coordinator.tick();
    await until(() => w.s.db.select().from(coordinatorLease).get()?.owner === null);
  });
});
