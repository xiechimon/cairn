import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Harness, SubmissionRecord } from '@earendil-works/pi-durable';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { createInputReceipts } from '../../src/coordinator/runtime/input-receipts.js';
import { createCoordinatorServerApi } from '../../src/coordinator/server-api.js';
import { coordinatorConversation, step } from '../../src/db/schema.js';
import { sendChiefMessage } from '../../src/services/chief.js';
import {
  pullCoordinatorInput,
  queueCoordinatorInput,
} from '../../src/services/coordinator-inputs.js';
import { H, registerChiefHarness } from '../chief-harness.js';

registerChiefHarness();

const row = (id: string) => H.s.db.select().from(step).where(eq(step.id, id)).get();

function deps() {
  return {
    db: H.s.db,
    hub: H.s.hub,
    machineHub: H.s.machineHub,
    box: H.s.secretBox,
    user: H.s.user,
    reposDir: H.s.reposDir,
    attachmentsDir: H.s.attachmentsDir,
    skillsDir: H.s.skillsDir,
    convHub: H.s.convHub,
  };
}

function supplement(parentId: string) {
  const suppId = sendChiefMessage({ db: H.s.db, user: H.s.user, hub: H.s.hub }, H.teamId, {
    threadId: H.threadId,
    content: 'accept the report',
  }).message.id;
  queueCoordinatorInput(H.s.db, row(parentId)!, row(suppId)!, 'accept the report');
  H.s.db
    .insert(coordinatorConversation)
    .values({
      threadId: H.threadId,
      storeId: 'store-1',
      conversationId: '7',
      piVersion: '1.5.0',
      updatedAt: 1,
    })
    .run();
  pullCoordinatorInput(H.s.db, parentId, 'store-1:7');
  return suppId;
}

function harnessOf(record: SubmissionRecord): Harness {
  return {
    observeCommits: () => ({ detach: () => {} }),
    commit: async (fn: (tx: unknown) => unknown) =>
      fn({
        submissionByRequest: async () => record,
        entry: async () => ({ model: [{ role: 'user', timestamp: 555 }] }),
      }),
  } as unknown as Harness;
}

test('a placed supplement authorizes tools in an ownerless report turn before its receipt fires', async () => {
  const parentId = 'run-1';
  H.s.db
    .insert(step)
    .values({
      id: parentId,
      buildId: H.threadId,
      kind: 'chief',
      status: 'claimed',
      machineId: null,
      ownerMessageIds: [],
      prompt: '[wake:event] provenance=report:t1\n',
      claimedAt: 1,
      createdAt: 1,
    })
    .run();
  const suppId = supplement(parentId);
  const record = {
    id: 9,
    type: 'input',
    status: 'placed',
    conversationId: 7,
    requestId: suppId,
    entry: 42,
  } as unknown as SubmissionRecord;
  const api = createCoordinatorServerApi(deps());
  const receipts = createInputReceipts(H.threadId, api.inputs!, BACKGROUND_CONTEXT, () => {});
  receipts.attach(harnessOf(record), 'store-1');

  await expect(api.relayTool(parentId, 'open_thread', { todoId: 'none' })).rejects.toMatchObject({
    status: 403,
  });
  await receipts.barrier();
  expect(row(parentId)?.ownerMessageIds).toEqual([suppId]);
  expect(row(suppId)).toBeUndefined();
  await expect(api.relayTool(parentId, 'open_thread', { todoId: 'none' })).rejects.toMatchObject({
    status: 404,
  });
});

test('an unanswered supplement is preserved for an authorized successor', async () => {
  const parentId = 'run-2';
  H.s.db
    .insert(step)
    .values({
      id: parentId,
      buildId: H.threadId,
      kind: 'chief',
      status: 'claimed',
      machineId: null,
      ownerMessageIds: [],
      prompt: '[wake:event] provenance=report:t1\n',
      claimedAt: 1,
      createdAt: 1,
    })
    .run();
  const suppId = supplement(parentId);
  const record = {
    id: 10,
    type: 'input',
    status: 'unanswered',
    conversationId: 7,
    requestId: suppId,
  } as unknown as SubmissionRecord;
  const api = createCoordinatorServerApi(deps());
  const receipts = createInputReceipts(H.threadId, api.inputs!, BACKGROUND_CONTEXT, () => {});
  receipts.attach(harnessOf(record), 'store-1');

  await receipts.barrier();
  expect(row(suppId)).toBeUndefined();
  const successor = H.s.db
    .select()
    .from(step)
    .all()
    .find((r) => r.id !== parentId);
  expect(successor?.ownerMessageIds).toEqual([suppId]);
});
