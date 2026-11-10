import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { acquireLease } from '../src/coordinator/lease.js';
import { coordinatorInput, steerPending, step } from '../src/db/schema.js';
import { sendChiefMessage } from '../src/services/chief.js';
import { releaseUnconsumedSteer, takeChiefSteer } from '../src/services/chief-turns.js';
import { migrateUnfetchedCoordinatorInputs } from '../src/services/coordinator-input-upgrade.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();
const row = (id: string) => H.s.db.select().from(step).where(eq(step.id, id)).get()!;
function legacy() {
  const send = (content: string) =>
    sendChiefMessage({ db: H.s.db, user: H.s.user, hub: H.s.hub }, H.teamId, {
      threadId: H.threadId,
      content,
    }).message.id;
  const parent = send('Start.');
  H.s.db.update(step).set({ status: 'claimed', machineId: null }).where(eq(step.id, parent)).run();
  const ids = [send('First image.'), send('Second image.')];
  for (const id of ids)
    H.s.db.update(step).set({ holdReason: 'steer' }).where(eq(step.id, id)).run();
  H.s.db
    .insert(steerPending)
    .values({
      conversationId: H.threadId,
      stepId: parent,
      content: 'Merged legacy transport content.',
      createdAt: 1,
    })
    .run();
  acquireLease(H.s.db, H.threadId, 'upgrade');
  const migrate = () => migrateUnfetchedCoordinatorInputs(H.s.db, H.threadId, 'upgrade');
  return { parent, ids, migrate };
}

test('provably unfetched legacy inputs each get one fresh successor preserving original scope and owners', () => {
  const w = legacy();
  expect(w.migrate()).toBe(2);
  const inputs = H.s.db.select().from(coordinatorInput).all();
  expect(inputs).toHaveLength(2);
  for (const input of inputs) {
    expect(input.state).toBe('released');
    expect(input.entryId).toBeNull();
    expect(input.successorStepId).not.toBe(input.id);
    expect(row(input.successorStepId!)).toMatchObject({
      ownerMessageIds: [input.id],
      prompt: input.content,
      scopeProjectId: null,
      holdReason: null,
    });
  }
  expect(inputs.map((input) => input.content).sort()).toEqual(['First image.', 'Second image.']);
  expect(row(w.parent).ownerMessageIds).toEqual([w.parent]);
  expect(H.s.db.select().from(steerPending).all()).toEqual([]);
  expect(w.migrate()).toBe(0);
  expect(H.s.db.select().from(step).all()).toHaveLength(3);
});

test('sent work remains blocked even while another buffer exists', () => {
  const w = legacy();
  H.s.db.update(step).set({ holdReason: 'steer_sent' }).where(eq(step.id, w.ids[0]!)).run();
  expect(w.migrate).toThrow('sent');
  expect(H.s.db.select().from(steerPending).all()).toHaveLength(1);
  expect(H.s.db.select().from(coordinatorInput).all()).toEqual([]);
});

test('an owner already attributed by the old sender is not declared unadmitted', () => {
  const w = legacy();
  H.s.db
    .update(step)
    .set({ ownerMessageIds: [w.parent, ...w.ids] })
    .where(eq(step.id, w.parent))
    .run();
  expect(w.migrate).toThrow('history');
  expect(H.s.db.select().from(coordinatorInput).all()).toEqual([]);
});

test('the daemon transport is left intact', () => {
  const w = legacy();
  H.s.db.update(step).set({ machineId: 'daemon' }).where(eq(step.id, w.parent)).run();
  expect(w.migrate()).toBe(0);
  expect(H.s.db.select().from(steerPending).all()).toHaveLength(1);
  expect(row(w.ids[0]!).holdReason).toBe('steer');
});

test('migration without the current lease owner is rejected', () => {
  legacy();
  expect(() => migrateUnfetchedCoordinatorInputs(H.s.db, H.threadId, 'other')).toThrow('lease');
});

test('a successor write failure rolls back the whole attempt and keeps the original buffer', () => {
  const w = legacy();
  H.s.db.run(
    "CREATE TRIGGER reject_successor BEFORE INSERT ON step BEGIN SELECT RAISE(FAIL, 'successor unavailable'); END",
  );
  expect(w.migrate).toThrow('successor unavailable');
  expect(H.s.db.select().from(coordinatorInput).all()).toEqual([]);
  expect(H.s.db.select().from(steerPending).all()).toHaveLength(1);
  expect(row(w.ids[0]!).holdReason).toBe('steer');
  H.s.db.run('DROP TRIGGER reject_successor');
  expect(w.migrate()).toBe(2);
});

test.each(['done', 'failed', 'stopped', 'pending'] as const)(
  'an earlier %s native target keeps re-steered admission unresolved',
  (status) => {
    const w = legacy();
    takeChiefSteer(H.s.db, H.threadId);
    releaseUnconsumedSteer(H.s.db, row(w.parent));
    H.s.db.delete(steerPending).run();
    H.s.db.update(step).set({ status }).where(eq(step.id, w.parent)).run();
    H.s.db
      .insert(step)
      .values({ ...row(w.parent), id: 'next-target', status: 'claimed', ownerMessageIds: [] })
      .run();
    H.s.db.update(step).set({ holdReason: 'steer' }).where(eq(step.id, w.ids[0]!)).run();
    H.s.db
      .insert(steerPending)
      .values({
        conversationId: H.threadId,
        stepId: 'next-target',
        content: row(w.ids[0]!).prompt!,
        createdAt: 2,
      })
      .run();
    expect(w.migrate).toThrow('history');
    expect(H.s.db.select().from(coordinatorInput).all()).toEqual([]);
    expect(H.s.db.select().from(steerPending).get()?.stepId).toBe('next-target');
  },
);
