import { transcriptPromptRowId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { chiefMessage, step } from '../src/db/schema.js';
import { enqueueChiefStep, sendChiefMessage } from '../src/services/chief.js';
import { receiveUpload } from '../src/services/machine-uploads.js';
import { reportTranscriptRow } from '../src/services/machines.js';
import { H, registerChiefHarness, toolDeps } from './chief-harness.js';
import { claimedGeneration, insertMachine } from './helpers.js';

registerChiefHarness();

const GREETING =
  '【新频道】用户刚打开项目「pointo」的新频道，还没有说话。用1到3句、以「xmon」称呼用户打招呼…必须先调用 suggest_replies…不要建任务。';

function claimedChiefStep(prompt: string, machineId: string): string {
  const stepId = enqueueChiefStep(toolDeps(), H.threadId, {
    prompt,
    trigger: 'user',
    ownerMessageIds: [],
  });
  H.s.db
    .update(step)
    .set({ machineId, status: 'claimed', claimedAt: 1 })
    .where(eq(step.id, stepId))
    .run();
  return stepId;
}

function stored(id: string) {
  return H.s.db.select().from(chiefMessage).where(eq(chiefMessage.id, id)).get();
}

test('a daemon transcript upload stamps the chief step prompt echo task-prompt', () => {
  const machineId = insertMachine(H.s, { name: 'uploader' });
  const stepId = claimedChiefStep(GREETING, machineId);
  receiveUpload(
    toolDeps(),
    { stepId, name: 'transcript', machineId, generation: claimedGeneration(H.s.db, stepId) },
    {
      stepId,
      messages: [
        { id: transcriptPromptRowId(stepId), role: 'user', content: GREETING, createdAt: 1 },
        { id: 'a-1', role: 'assistant', content: 'xmon，新频道好。', createdAt: 2 },
      ],
    },
  );
  expect(stored(transcriptPromptRowId(stepId))?.origin).toBe('task-prompt');
  expect(stored('a-1')?.origin).toBeNull();
});

test('a live transcript row report stamps the chief prompt echo task-prompt', () => {
  const machineId = insertMachine(H.s, { name: 'reporter' });
  const stepId = claimedChiefStep(GREETING, machineId);
  reportTranscriptRow(toolDeps(), machineId, stepId, {
    id: transcriptPromptRowId(stepId),
    role: 'user',
    content: GREETING,
    createdAt: 1,
  });
  expect(stored(transcriptPromptRowId(stepId))?.origin).toBe('task-prompt');
});

test('owner words sent through the composer are stamped user', () => {
  const sent = sendChiefMessage(toolDeps(), H.teamId, {
    threadId: H.threadId,
    content: 'real owner words',
  });
  expect(stored(sent.message.id)?.origin).toBe('user');
});

test('a machine transcript row cannot erase the user origin on the step id it claimed', () => {
  const machineId = insertMachine(H.s, { name: 'eraser' });
  const sent = sendChiefMessage(toolDeps(), H.teamId, {
    threadId: H.threadId,
    content: 'real owner words',
  });
  const stepId = sent.message.id;
  H.s.db.update(step).set({ machineId, status: 'claimed' }).where(eq(step.id, stepId)).run();
  reportTranscriptRow(toolDeps(), machineId, stepId, {
    id: stepId,
    role: 'user',
    content: 'machine echo of the same step id',
    createdAt: 1,
  });
  expect(stored(sent.message.id)?.origin).toBe('user');
});
