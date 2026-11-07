import { shortEvent } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { chiefMessage, step } from '../../src/db/schema.js';
import { enqueueChiefStep, wakeProvenance } from '../../src/services/chief.js';
import { readHistory } from '../../src/services/chief-history.js';
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
    expect(secondRequest).toContain(`[history id: user-${wakeId}]`);
    expect(secondRequest).toContain('Task #3 finished');
  });

  it('read_history returns the full text of an event the model only saw in short form', async () => {
    const w = await world('status?');
    const { faux } = stub('ok');
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    const body = `${'report line '.repeat(1_000)}REPORT-TAIL`;
    const wakeId = enqueueChiefStep(w.s.svc, w.threadId, {
      prompt: body,
      trigger: 'settle',
      provenance: wakeProvenance('w2'),
    });
    coordinator.wake(w.threadId);
    await coordinator.idle();

    const stored = w.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, `user-${wakeId}`))
      .get();
    const short = shortEvent(String(stored?.content), `user-${wakeId}`) ?? '';
    expect(short).not.toContain('REPORT-TAIL');
    const pointer = /read_history ids \["([^"]+)"\]/.exec(short)?.[1] ?? '';
    const read = readHistory(
      w.s.db,
      { threadId: w.threadId, userId: w.s.user.id, teamId: w.teamId },
      [pointer],
      { maxChars: 20_000 },
    );
    expect(read.messages[0]?.content).toContain('REPORT-TAIL');
    expect(read.messages[0]?.role).toBe('user');
  });
});
