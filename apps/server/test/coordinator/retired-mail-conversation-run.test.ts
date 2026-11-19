import { coordinatorConversationKey } from '@cairn/shared';
import { expect, test } from 'vitest';
import { createCoordinatorServerApi } from '../../src/coordinator/server-api.js';
import { coordinatorConversation, coordinatorInput } from '../../src/db/schema.js';
import { H, registerChiefHarness } from '../chief-harness.js';

registerChiefHarness();

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

test('an interrupted mail turn run is rebound after its conversation was retired, so the thread reopens', async () => {
  const mailConversation = coordinatorConversationKey('store-1', '2019');
  H.s.db
    .insert(coordinatorConversation)
    .values({
      threadId: H.threadId,
      storeId: 'store-1',
      conversationId: '1',
      piVersion: '1.5.0',
      updatedAt: 1,
    })
    .run();
  H.s.db
    .insert(coordinatorInput)
    .values({
      id: 'mail-input',
      threadId: H.threadId,
      stepId: 'mail-step',
      kind: 'initial',
      ownerMessageIds: [],
      content: 'mail',
      conversationId: mailConversation,
      state: 'consumed',
      entryId: '2025',
      createdAt: 1,
    })
    .run();
  const api = createCoordinatorServerApi(deps());
  await api.inputs?.bindRun(H.threadId, mailConversation, '2027', ['mail-input']);
  expect(await api.inputs?.runs(H.threadId)).toEqual([
    { threadId: H.threadId, conversationId: mailConversation, taskId: '2027', stepId: 'mail-step' },
  ]);
});
