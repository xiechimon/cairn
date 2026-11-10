import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { coordinatorConversation, step } from '../src/db/schema.js';
import { sendChiefMessage } from '../src/services/chief.js';
import {
  ackChiefSteer,
  chiefPendingMessages,
  releaseUnconsumedSteer,
  takeChiefSteer,
  withdrawChiefMessage,
} from '../src/services/chief-turns.js';
import {
  consumeCoordinatorInput,
  pullCoordinatorInput,
  queueCoordinatorInput,
  releaseCoordinatorInput,
} from '../src/services/coordinator-inputs.js';
import { claimPendingChiefStep } from '../src/services/coordinator-steps.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();
const row = (id: string) => H.s.db.select().from(step).where(eq(step.id, id)).get()!;
function heldBatch() {
  const send = (content: string) =>
    sendChiefMessage({ db: H.s.db, user: H.s.user, hub: H.s.hub }, H.teamId, {
      threadId: H.threadId,
      content,
    }).message.id;
  const parentId = send('Start.');
  H.s.db
    .update(step)
    .set({ status: 'claimed', machineId: null })
    .where(eq(step.id, parentId))
    .run();
  const id = send('Keep my image.');
  queueCoordinatorInput(H.s.db, row(parentId), row(id), 'Keep my image.');
  return { parentId, id };
}

test('native batch ownership blocks both claim platforms even if its hold tag is lost', () => {
  const b = heldBatch();
  H.s.db.update(step).set({ holdReason: null }).where(eq(step.id, b.id)).run();
  expect(claimPendingChiefStep(H.s.db, row(b.id), null)).toBe(false);
  expect(claimPendingChiefStep(H.s.db, row(b.id), 'daemon')).toBe(false);
});

test('legacy holds without a native batch keep their existing claim behavior', () => {
  const b = heldBatch();
  const legacy = { ...row(b.id), id: 'legacy-held' };
  H.s.db.insert(step).values(legacy).run();
  expect(claimPendingChiefStep(H.s.db, row(legacy.id), 'daemon')).toBe(true);
});

test('legacy pull and acknowledgment cannot attribute or retire a native batch', () => {
  const b = heldBatch();
  takeChiefSteer(H.s.db, H.threadId);
  expect(row(b.parentId).ownerMessageIds).toEqual([b.parentId]);
  expect(row(b.id).holdReason).toBe('steer');
  H.s.db.update(step).set({ holdReason: 'steer_sent' }).where(eq(step.id, b.id)).run();
  ackChiefSteer({ db: H.s.db }, H.teamId, row(b.parentId));
  expect(row(b.id)).toBeDefined();
});

test('finishing a target retains uncertain native work for durable reconciliation', () => {
  const b = heldBatch();
  releaseUnconsumedSteer(H.s.db, row(b.parentId));
  expect(row(b.id).holdReason).toBe('steer');
});

test('a released successor displays and withdraws under its authentic owner identity', () => {
  const b = heldBatch();
  H.s.db
    .update(step)
    .set({ status: 'waiting_quota', holdReason: null })
    .where(eq(step.id, b.id))
    .run();
  releaseCoordinatorInput(H.s.db, b.id, null);
  expect(row(b.id)).toBeUndefined();
  expect(chiefPendingMessages(H.s.db, H.threadId)).toContainEqual({
    messageId: b.id,
    state: 'held',
  });
  expect(withdrawChiefMessage({ db: H.s.db }, H.teamId, H.threadId, b.id)).toEqual({ ok: true });
  expect(H.s.db.select().from(step).all()).toHaveLength(1);
});

test.each(['pending', 'waiting_quota'] as const)(
  'a receipt retires its %s execution after hold metadata loss',
  (status) => {
    const b = heldBatch();
    H.s.db.update(step).set({ holdReason: null, status }).where(eq(step.id, b.id)).run();
    H.s.db
      .insert(coordinatorConversation)
      .values({ threadId: H.threadId, conversationId: '2', piVersion: '1.5.0', updatedAt: 1 })
      .run();
    expect(pullCoordinatorInput(H.s.db, b.parentId, '2')?.id).toBe(b.id);
    consumeCoordinatorInput(H.s.db, b.id, '2', '4');
    expect(row(b.id)).toBeUndefined();
    expect(H.s.db.select().from(step).all()).toHaveLength(1);
  },
);
