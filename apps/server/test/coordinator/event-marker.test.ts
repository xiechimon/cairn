import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { step } from '../../src/db/schema.js';
import { enqueueChiefStep, wakeProvenance } from '../../src/services/chief.js';
import { boot, stub, world } from './runner-world.js';

describe('event turns carry their history id', () => {
  it('appends the step id to a wake prompt but leaves a user prompt as typed', async () => {
    const w = await world('status?');
    const { faux, seen } = stub('ok');
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();

    const wakeId = enqueueChiefStep(w.s.svc, w.threadId, {
      prompt: 'Task #3 finished',
      trigger: 'settle',
      provenance: wakeProvenance('w1'),
    });
    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(w.s.db.select().from(step).where(eq(step.id, wakeId)).get()?.status).toBe('done');
    const firstRequest = JSON.stringify(seen[0]?.messages);
    const secondRequest = JSON.stringify(seen[1]?.messages);
    expect(firstRequest).not.toContain('history id');
    expect(secondRequest).toContain(`[history id: ${wakeId}]`);
    expect(secondRequest).toContain('Task #3 finished');
  });
});
