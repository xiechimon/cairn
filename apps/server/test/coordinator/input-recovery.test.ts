import { and, eq, inArray } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import {
  chiefMessage,
  coordinatorConversation,
  coordinatorEntry,
  coordinatorInput,
  coordinatorLease,
  step,
} from '../../src/db/schema.js';
import { boot, stub, world } from './runner-world.js';

test('restart restores mirror debt after receipt commit even with a failed producer and no pending input', async () => {
  const w = await world('Keep the exact stored answer.');
  const { faux, seen } = stub('Stored answer to recover.');
  const first = boot(w, faux);
  first.wake(w.threadId);
  await first.idle();
  await first.close();
  const rows = w.s.db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.threadId, w.threadId), eq(chiefMessage.role, 'assistant')))
    .all();
  expect(rows.length).toBeGreaterThan(0);
  const ids = rows.map((row) => row.id);
  const input = w.s.db
    .select()
    .from(coordinatorInput)
    .where(eq(coordinatorInput.id, w.stepId))
    .get()!;
  expect(input.state).toBe('consumed');
  w.s.db.delete(chiefMessage).where(inArray(chiefMessage.id, ids)).run();
  w.s.db.delete(coordinatorEntry).where(inArray(coordinatorEntry.chiefMessageId, ids)).run();
  w.s.db
    .update(coordinatorConversation)
    .set({ lastMirroredEntryId: input.entryId })
    .where(eq(coordinatorConversation.threadId, w.threadId))
    .run();
  w.s.db.update(step).set({ status: 'failed' }).where(eq(step.id, w.stepId)).run();
  const calls = seen.length;
  const outcomes: string[] = [];
  const second = boot(w, faux, {
    logger: {
      info: (event: { outcome?: string }) => {
        if (event.outcome) outcomes.push(event.outcome);
      },
      warn: () => {},
      error: () => {},
    },
  });
  second.tick();
  await vi.waitFor(
    () =>
      expect(
        w.s.db.select().from(chiefMessage).where(inArray(chiefMessage.id, ids)).all(),
      ).toHaveLength(rows.length),
    { timeout: 8000 },
  );
  expect(seen).toHaveLength(calls);
  expect(outcomes).toEqual(['unchanged']);
  expect(w.s.db.select().from(chiefMessage).where(inArray(chiefMessage.id, ids)).all()).toEqual(
    rows,
  );
}, 15000);

test('a failed receipt at shutdown releases the lease and recovers placed input after its parent fails', async () => {
  const w = await world('Persist this placement before any model request.');
  const { faux, seen } = stub('No repeated model request.');
  w.s.db.run(
    "CREATE TRIGGER reject_receipt BEFORE INSERT ON coordinator_entry BEGIN SELECT RAISE(FAIL, 'receipt unavailable'); END",
  );
  let failures = 0;
  const first = boot(w, faux, {
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {
        failures++;
      },
    },
  });
  first.wake(w.threadId);
  await vi.waitFor(() => expect(failures).toBeGreaterThan(0), { timeout: 8000 });
  expect(w.s.db.select().from(coordinatorInput).get()?.state).toBe('pending');
  expect(seen).toHaveLength(0);
  await expect(first.close()).rejects.toThrow('receipt unavailable');
  expect(w.s.db.select().from(coordinatorLease).get()?.owner).toBeNull();
  w.s.db.run('DROP TRIGGER reject_receipt');
  w.s.db.update(step).set({ status: 'failed' }).where(eq(step.id, w.stepId)).run();
  const second = boot(w, faux);
  second.tick();
  await second.idle();
  expect(w.s.db.select().from(coordinatorInput).get()?.state).toBe('consumed');
  expect(
    w.s.db
      .select()
      .from(coordinatorEntry)
      .where(eq(coordinatorEntry.chiefMessageId, w.stepId))
      .get(),
  ).toBeDefined();
  expect(seen).toHaveLength(0);
}, 15000);
