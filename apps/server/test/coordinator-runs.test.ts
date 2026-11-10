import { coordinatorConversationKey } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { chiefThread, coordinatorInput, coordinatorRun } from '../src/db/schema.js';
import { bindCoordinatorRun, coordinatorRuns } from '../src/services/coordinator-runs.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();

function input(
  id: string,
  stepId = 'producer',
  conversationId = 'store_one:1',
  state: 'pending' | 'consumed' = 'consumed',
) {
  H.s.db
    .insert(coordinatorInput)
    .values({
      id,
      threadId: H.threadId,
      stepId,
      kind: 'steer',
      ownerMessageIds: [id],
      content: 'Image.',
      conversationId,
      state,
      entryId: state === 'consumed' ? '5' : null,
      createdAt: 1,
    })
    .run();
}

const bind = (ids: string[], conversationId = 'store_one:1', taskId = '7') =>
  bindCoordinatorRun(H.s.db, H.threadId, conversationId, taskId, ids);

test('generation binding persists exact consumed authority and retries idempotently', () => {
  input('first');
  input('second');
  bind(['first', 'second']);
  bind(['second', 'first']);
  expect(coordinatorRuns(H.s.db, H.threadId)).toEqual([
    { threadId: H.threadId, conversationId: 'store_one:1', taskId: '7', stepId: 'producer' },
  ]);
});

test('admission, unknown input and empty authority cannot bind a generation', () => {
  input('queued', 'producer', 'store_one:1', 'pending');
  expect(() => bind(['queued'])).toThrow('incomplete');
  expect(() => bind(['unknown'])).toThrow('incomplete');
  expect(() => bind([])).toThrow('no input authority');
  expect(coordinatorRuns(H.s.db, H.threadId)).toEqual([]);
});

test('a run cannot combine input from different producers or conversations', () => {
  input('first');
  input('foreign', 'other');
  input('another-conversation', 'producer', 'store_one:2');
  expect(() => bind(['first', 'foreign'])).toThrow('producer boundaries');
  expect(() => bind(['first', 'another-conversation'])).toThrow('incomplete');
});

test('an existing task identity cannot be rebound to another producer', () => {
  input('first');
  input('foreign', 'other');
  bind(['first']);
  expect(() => bind(['foreign'])).toThrow('another producer');
  expect(coordinatorRuns(H.s.db, H.threadId)[0]?.stepId).toBe('producer');
});

test('reused numeric conversation/task IDs in another store have distinct bindings', () => {
  const before = coordinatorConversationKey('store_one', '1');
  const after = coordinatorConversationKey('store_two', '1');
  input('first', 'before', before);
  input('second', 'after', after);
  bind(['first'], before);
  bind(['second'], after);
  expect(
    coordinatorRuns(H.s.db, H.threadId)
      .map((run) => run.stepId)
      .sort(),
  ).toEqual(['after', 'before']);
});

test('thread deletion removes the bindings and their receipt authority', () => {
  input('first');
  bind(['first']);
  H.s.db.delete(chiefThread).where(eq(chiefThread.id, H.threadId)).run();
  expect(H.s.db.select().from(coordinatorRun).all()).toEqual([]);
  expect(H.s.db.select().from(coordinatorInput).all()).toEqual([]);
});

test('initial input identity is unique within its qualified conversation', () => {
  input('first');
  H.s.db
    .update(coordinatorInput)
    .set({ kind: 'initial' })
    .where(eq(coordinatorInput.id, 'first'))
    .run();
  input('second');
  expect(() =>
    H.s.db
      .update(coordinatorInput)
      .set({ kind: 'initial' })
      .where(eq(coordinatorInput.id, 'second'))
      .run(),
  ).toThrow('UNIQUE');
});
