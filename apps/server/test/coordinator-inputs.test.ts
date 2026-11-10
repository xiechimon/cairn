import { eq } from 'drizzle-orm';
import { beforeEach, expect, test } from 'vitest';
import {
  chiefMessage,
  chiefThread,
  coordinatorConversation,
  coordinatorEntry,
  coordinatorInput,
  step,
} from '../src/db/schema.js';
import { sendChiefMessage } from '../src/services/chief.js';
import {
  consumeCoordinatorInput,
  coordinatorInputIsLive,
  coordinatorInputs,
  prepareCoordinatorInput,
  pullCoordinatorInput,
  queueCoordinatorInput,
  releaseCoordinatorInput,
} from '../src/services/coordinator-inputs.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();
let parentId = '';
const row = (id: string) => H.s.db.select().from(step).where(eq(step.id, id)).get();
const batch = (id: string) =>
  H.s.db.select().from(coordinatorInput).where(eq(coordinatorInput.id, id)).get();
const deps = () => ({ db: H.s.db, user: H.s.user, hub: H.s.hub, machineHub: H.s.machineHub });
const send = (content: string) =>
  sendChiefMessage(deps(), H.teamId, { threadId: H.threadId, content }).message.id;
function queue(content = 'Image request.') {
  const id = send(content);
  queueCoordinatorInput(H.s.db, row(parentId)!, row(id)!, content);
  return id;
}
function pull() {
  return pullCoordinatorInput(H.s.db, parentId, 'conversation-1');
}

beforeEach(() => {
  parentId = send('Start.');
  H.s.db
    .update(step)
    .set({ status: 'claimed', machineId: null })
    .where(eq(step.id, parentId))
    .run();
  H.s.db
    .insert(coordinatorConversation)
    .values({
      threadId: H.threadId,
      conversationId: 'conversation-1',
      piVersion: '1.5.0',
      updatedAt: 1,
    })
    .run();
});

test('initial input freezes owner identity and content before later steers', () => {
  const original = prepareCoordinatorInput(H.s.db, parentId, 'conversation-1', 'Start.');
  const later = send('Later.');
  H.s.db
    .update(step)
    .set({ ownerMessageIds: [parentId, later] })
    .where(eq(step.id, parentId))
    .run();
  expect(prepareCoordinatorInput(H.s.db, parentId, 'conversation-1', 'Changed.')).toEqual(original);
  expect(original.ownerMessageIds).toEqual([parentId]);
});

test('queue and repeated pull retain the same frozen batch without early attribution', () => {
  const id = queue('First.');
  const first = pull();
  queue('Second.');
  expect(pull()).toEqual(first);
  expect(first).toMatchObject({ id, content: 'First.', state: 'pending' });
  expect(row(id)?.holdReason).toBe('steer');
  expect(row(parentId)?.ownerMessageIds).toEqual([parentId]);
  expect(H.s.db.select().from(coordinatorEntry).all()).toEqual([]);
});

test('consumption atomically records the exact batch and a repeated old receipt leaves newer work pending', () => {
  const first = queue('Same.');
  pull();
  const second = queue('Same.');
  consumeCoordinatorInput(H.s.db, first, 'conversation-1', '5');
  expect(row(first)).toBeUndefined();
  expect(row(second)?.holdReason).toBe('steer');
  expect(row(parentId)?.ownerMessageIds).toEqual([parentId, first]);
  expect(batch(first)).toMatchObject({ state: 'consumed', entryId: '5' });
  expect(
    H.s.db.select().from(coordinatorEntry).where(eq(coordinatorEntry.chiefMessageId, first)).get(),
  ).toMatchObject({ conversationId: 'conversation-1', entryId: '5' });
  consumeCoordinatorInput(H.s.db, first, 'conversation-1', '5');
  expect(pull()?.id).toBe(second);
  expect(() => consumeCoordinatorInput(H.s.db, first, 'conversation-1', '6')).toThrow(
    'different receipt',
  );
});

test('receipt write failure rolls back attribution and leaves the batch retryable', () => {
  const id = queue();
  pull();
  H.s.db.run(
    `CREATE TRIGGER reject_receipt BEFORE INSERT ON coordinator_entry BEGIN SELECT RAISE(FAIL, 'receipt unavailable'); END`,
  );
  expect(() => consumeCoordinatorInput(H.s.db, id, 'conversation-1', '5')).toThrow(
    'receipt unavailable',
  );
  expect(batch(id)?.state).toBe('pending');
  expect(row(id)?.holdReason).toBe('steer');
  expect(row(parentId)?.ownerMessageIds).toEqual([parentId]);
  H.s.db.run('DROP TRIGGER reject_receipt');
  consumeCoordinatorInput(H.s.db, id, 'conversation-1', '5');
  expect(batch(id)?.state).toBe('consumed');
});

test('a genuine late placement remains consumable after its parent failed', () => {
  const id = queue();
  pull();
  H.s.db.update(step).set({ status: 'failed' }).where(eq(step.id, parentId)).run();
  consumeCoordinatorInput(H.s.db, id, 'conversation-1', '5');
  expect(batch(id)?.state).toBe('consumed');
  expect(row(id)).toBeUndefined();
});

test('a rejected batch releases once to a distinct execution identity and preserves its owner', () => {
  const id = queue('Retry this.');
  pull();
  releaseCoordinatorInput(H.s.db, id, 'conversation-1');
  const released = batch(id)!;
  expect(released.successorStepId).not.toBe(id);
  expect(released.state).toBe('released');
  expect(row(id)).toBeUndefined();
  expect(row(released.successorStepId!)).toMatchObject({
    status: 'pending',
    prompt: 'Retry this.',
    ownerMessageIds: [id],
    holdReason: null,
  });
  releaseCoordinatorInput(H.s.db, id, 'conversation-1');
  expect(H.s.db.select().from(step).all()).toHaveLength(2);
  H.s.db
    .update(step)
    .set({ status: 'claimed' })
    .where(eq(step.id, released.successorStepId!))
    .run();
  const initial = prepareCoordinatorInput(
    H.s.db,
    released.successorStepId!,
    'conversation-1',
    'Retry this.',
  );
  consumeCoordinatorInput(H.s.db, initial.id, 'conversation-1', '8');
  expect(
    H.s.db.select().from(coordinatorEntry).where(eq(coordinatorEntry.chiefMessageId, id)).get()
      ?.entryId,
  ).toBe('8');
});

test('a consumed batch cannot be released or replayed', () => {
  const id = queue();
  pull();
  consumeCoordinatorInput(H.s.db, id, 'conversation-1', '5');
  releaseCoordinatorInput(H.s.db, id, 'conversation-1');
  expect(batch(id)?.state).toBe('consumed');
  expect(row(id)).toBeUndefined();
  expect(H.s.db.select().from(step).all()).toHaveLength(1);
});

test('changing conversations rejects stale placement and binding', () => {
  const id = queue();
  pull();
  H.s.db
    .update(coordinatorConversation)
    .set({ conversationId: 'conversation-2' })
    .where(eq(coordinatorConversation.threadId, H.threadId))
    .run();
  expect(() => consumeCoordinatorInput(H.s.db, id, 'conversation-1', '5')).toThrow(
    'conversation changed',
  );
  expect(() => pullCoordinatorInput(H.s.db, parentId, 'conversation-2')).toThrow(
    'different conversation',
  );
  expect(batch(id)?.state).toBe('pending');
});

test('a rewind-deleted owner is not recreated by a late receipt', () => {
  const id = queue();
  pull();
  H.s.db.delete(chiefMessage).where(eq(chiefMessage.id, id)).run();
  consumeCoordinatorInput(H.s.db, id, 'conversation-1', '5');
  expect(batch(id)?.state).toBe('consumed');
  expect(
    H.s.db.select().from(coordinatorEntry).where(eq(coordinatorEntry.chiefMessageId, id)).get(),
  ).toBeUndefined();
  expect(row(parentId)?.ownerMessageIds).not.toContain(id);
});

test('a live consumed submission remains recoverable after its waiting step is deleted', () => {
  const id = queue();
  pull();
  consumeCoordinatorInput(H.s.db, id, 'conversation-1', '5');
  expect(coordinatorInputIsLive(H.s.db, id)).toBe(true);
  H.s.db.update(step).set({ status: 'stopped' }).where(eq(step.id, parentId)).run();
  expect(coordinatorInputIsLive(H.s.db, id)).toBe(false);
  expect(coordinatorInputIsLive(H.s.db, 'unknown')).toBeUndefined();
});

test('native input preparation rejects another execution platform and a foreign target', () => {
  H.s.db.update(step).set({ machineId: 'daemon' }).where(eq(step.id, parentId)).run();
  expect(() => prepareCoordinatorInput(H.s.db, parentId, 'conversation-1', 'Start.')).toThrow(
    'native claimed step',
  );
  const id = send('Other.');
  expect(() => queueCoordinatorInput(H.s.db, row(parentId)!, row(id)!, 'Other.')).toThrow(
    'native claimed target',
  );
});

test('thread deletion cascades input batches', () => {
  queue();
  H.s.db.delete(chiefThread).where(eq(chiefThread.id, H.threadId)).run();
  expect(coordinatorInputs(H.s.db, H.threadId)).toEqual([]);
});

test('repeated owner consumption preserves both immutable receipt positions', () => {
  prepareCoordinatorInput(H.s.db, parentId, 'conversation-1', 'Start.');
  consumeCoordinatorInput(H.s.db, parentId, 'conversation-1', '1');
  const next = send('Continue.');
  H.s.db
    .update(step)
    .set({ status: 'claimed', ownerMessageIds: [parentId] })
    .where(eq(step.id, next))
    .run();
  prepareCoordinatorInput(H.s.db, next, 'conversation-1', 'Start.');
  consumeCoordinatorInput(H.s.db, next, 'conversation-1', '9');
  expect(
    coordinatorInputs(H.s.db, H.threadId).map((input) => ({
      entry: input.entryId,
      owners: input.ownerMessageIds,
    })),
  ).toEqual([
    { entry: '1', owners: [parentId] },
    { entry: '9', owners: [parentId] },
  ]);
  expect(
    H.s.db
      .select()
      .from(coordinatorEntry)
      .where(eq(coordinatorEntry.chiefMessageId, parentId))
      .get()?.entryId,
  ).toBe('9');
});

test('an old admitted initial input cannot adopt later mutable owners during an upgrade', () => {
  const later = send('Later.');
  H.s.db
    .update(step)
    .set({ ownerMessageIds: [parentId, later] })
    .where(eq(step.id, parentId))
    .run();
  const initial = prepareCoordinatorInput(H.s.db, parentId, 'conversation-1', 'Start.', '1');
  expect(initial.ownerMessageIds).toEqual([parentId]);
});
