import { and, eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { createCoordinatorServerApi } from '../../src/coordinator/server-api.js';
import { chiefMessage, step } from '../../src/db/schema.js';
import { H, registerChiefHarness } from '../chief-harness.js';
import { req } from '../helpers.js';

registerChiefHarness();

test('replaying a mirrored Coordinator row publishes nothing, while a changed row still updates', async () => {
  await req(H.s.app, 'POST', `/api/conversations/${H.threadId}/messages`, {
    content: 'hello',
    clientMessageId: 'key-1',
  });
  const turn = H.s.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, H.threadId), eq(step.kind, 'chief')))
    .get();
  if (turn === undefined) throw new Error('no Coordinator turn');
  H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, turn.id)).run();
  const api = createCoordinatorServerApi({
    ...H.s.svc,
    box: H.s.secretBox,
    reposDir: H.s.reposDir,
    attachmentsDir: H.s.attachmentsDir,
  });
  const published: unknown[] = [];
  H.s.convHub.subscribe(H.threadId, {
    nextSeq: () => 1,
    send: (payload: { type?: string; message?: { content?: unknown } }) => {
      if (payload.type === 'message') published.push(payload.message?.content);
      return Promise.resolve();
    },
  });
  const row = {
    id: `native-store:${turn.id}-e3`,
    role: 'assistant' as const,
    content: [{ type: 'text', text: 'Received.' }],
    createdAt: 1_000,
  };
  await api.transcriptRow(turn.id, row, '3');
  await api.transcriptRow(turn.id, { ...row, content: [{ type: 'text', text: 'Received.' }] }, '3');
  await api.transcriptRow(turn.id, { ...row, content: [{ type: 'text', text: 'Updated.' }] }, '3');
  expect(published).toEqual([
    [{ type: 'text', text: 'Received.' }],
    [{ type: 'text', text: 'Updated.' }],
  ]);
  expect(
    H.s.db.select().from(chiefMessage).where(eq(chiefMessage.id, row.id)).get()?.content,
  ).toEqual([{ type: 'text', text: 'Updated.' }]);
});
