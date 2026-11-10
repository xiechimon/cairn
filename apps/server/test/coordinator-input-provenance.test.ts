import { encodeReplyQuote } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { chiefMessage, coordinatorEntry, coordinatorInput, step } from '../src/db/schema.js';
import { sendChiefMessage } from '../src/services/chief.js';
import { resolveTaskReplyContext } from '../src/services/task-reply-context.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();

function source() {
  const sent = sendChiefMessage(
    { db: H.s.db, user: H.s.user, hub: H.s.hub, machineHub: H.s.machineHub },
    H.teamId,
    { threadId: H.threadId, content: 'Original image.' },
  );
  const owner = sent.message.id;
  const answer = `${owner}-e5`;
  H.s.db
    .insert(chiefMessage)
    .values({
      id: answer,
      threadId: H.threadId,
      role: 'assistant',
      content: 'I saw the image.',
      createdAt: 2,
    })
    .run();
  H.s.db
    .insert(coordinatorEntry)
    .values({
      chiefMessageId: answer,
      threadId: H.threadId,
      conversationId: '1',
      entryId: '5',
    })
    .run();
  const receipt = (
    id: string,
    entryId: string | null,
    state: 'pending' | 'consumed' | 'released' = 'consumed',
    conversationId = '1',
  ) => {
    H.s.db
      .insert(coordinatorInput)
      .values({
        id,
        threadId: H.threadId,
        stepId: owner,
        kind: 'initial',
        ownerMessageIds: [owner],
        content: 'Original image.',
        conversationId,
        state,
        entryId,
        createdAt: 1,
      })
      .run();
  };
  const resolve = () =>
    resolveTaskReplyContext(
      H.s.db,
      H.threadId,
      'new-message',
      encodeReplyQuote({ sourceMessageId: answer, quote: 'I saw the image.' }, 'Dispatch it.'),
    );
  return { owner, answer, receipt, resolve };
}

test('native receipt survives a later consumption overwriting the derived owner index', () => {
  const s = source();
  s.receipt(s.owner, '1');
  H.s.db
    .insert(coordinatorEntry)
    .values({ chiefMessageId: s.owner, threadId: H.threadId, conversationId: '1', entryId: '9' })
    .run();
  expect(s.resolve()?.messages.map((m) => m.messageId)).toEqual([s.owner, s.answer]);
});

test.each([
  ['pending', null, '1'],
  ['released', null, '1'],
  ['consumed', '9', '1'],
  ['consumed', '1', '2'],
] as const)(
  'native %s receipt at %s in conversation %s cannot use legacy owner fallback',
  (state, entry, conversation) => {
    const s = source();
    s.receipt(s.owner, entry, state, conversation);
    expect(s.resolve()?.messages.map((m) => m.messageId)).toEqual([s.answer]);
  },
);

test('deleted native owner remains incomplete and is never reconstructed from frozen text', () => {
  const s = source();
  s.receipt(s.owner, '1');
  H.s.db.delete(chiefMessage).where(eq(chiefMessage.id, s.owner)).run();
  expect(s.resolve()).toMatchObject({ incomplete: true, messages: [{ messageId: s.answer }] });
});

test('native producer with no eligible receipt cannot inherit a later mutable owner', () => {
  const s = source();
  s.receipt(s.owner, '9');
  H.s.db
    .update(step)
    .set({ ownerMessageIds: [s.owner] })
    .where(eq(step.id, s.owner))
    .run();
  expect(s.resolve()?.messages).toHaveLength(1);
});

test.each([
  ['store_one', true],
  ['store_two', true],
  ['store_one', false],
] as const)(
  'a native source from %s requires its matching ledger (%s)',
  (sourceStore, hasLedger) => {
    const s = source();
    const nativeId = `native-${sourceStore}:${s.owner}-e5`;
    H.s.db
      .insert(chiefMessage)
      .values({
        id: nativeId,
        threadId: H.threadId,
        role: 'assistant',
        content: 'Native answer.',
        createdAt: 3,
      })
      .run();
    H.s.db
      .insert(coordinatorEntry)
      .values({
        chiefMessageId: nativeId,
        threadId: H.threadId,
        conversationId: 'store_one:1',
        entryId: '5',
      })
      .run();
    if (hasLedger) s.receipt(s.owner, '1', 'consumed', 'store_one:1');
    const context = resolveTaskReplyContext(
      H.s.db,
      H.threadId,
      'new-message',
      encodeReplyQuote({ sourceMessageId: nativeId, quote: 'Native answer.' }, 'Dispatch.'),
    );
    expect(context?.messages.map((message) => message.messageId)).toEqual(
      sourceStore === 'store_one' && hasLedger ? [s.owner, nativeId] : [nativeId],
    );
  },
);

test('a native input without authentic owner identity remains incomplete', () => {
  const s = source();
  s.receipt(s.owner, '1');
  H.s.db
    .update(coordinatorInput)
    .set({ ownerMessageIds: [] })
    .where(eq(coordinatorInput.id, s.owner))
    .run();
  expect(s.resolve()).toMatchObject({ incomplete: true, messages: [{ messageId: s.answer }] });
});
