import type { ChiefMemoryTrace, ChiefMemoryUsageResponse } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { chiefThread, step } from '../src/db/schema.js';
import { enqueueChiefStep } from '../src/services/chief.js';
import { writeMemoryTrace } from '../src/services/step-groups/memory-trace.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';
import { seedOwnerMessage } from './owner-message.js';
import { insertStepFixture } from './step-groups-fixture.js';

registerChiefHarness();

const trace = (over: Partial<ChiefMemoryTrace>): ChiefMemoryTrace => ({
  teamMemoryIds: [],
  teamMemoriesOmitted: 0,
  projectMemoryIds: [],
  projectMemoriesOmitted: 0,
  recalledMemoryIds: [],
  ...over,
});

function tracedStep(prompt: string, createdAt?: number): string {
  const ownerMessageId = seedOwnerMessage(H.s.db, H.threadId, prompt);
  const id = enqueueChiefStep(H.s.svc, H.threadId, {
    prompt,
    trigger: 'user',
    ownerMessageIds: [ownerMessageId],
  });
  if (createdAt !== undefined) {
    H.s.db.update(step).set({ createdAt }).where(eq(step.id, id)).run();
  }
  return id;
}

test('returns usage null when no traced turn exists', async () => {
  const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/memory-usage`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ usage: null });
});

test('returns the trace stored on the latest chief step', async () => {
  const stepId = tracedStep('deploy to the linux box');
  H.s.db.transaction((tx) =>
    writeMemoryTrace(tx, stepId, {
      memoryTrace: trace({
        teamMemoryIds: ['mem-1'],
        teamMemoriesOmitted: 2,
        projectMemoryIds: ['mem-2'],
        recalledMemoryIds: ['mem-3'],
      }),
    }),
  );
  const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/memory-usage`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    usage: {
      stepId,
      threadId: H.threadId,
      createdAt: expect.any(Number),
      teamMemoryIds: ['mem-1'],
      teamMemoriesOmitted: 2,
      projectMemoryIds: ['mem-2'],
      projectMemoriesOmitted: 0,
      recalledMemoryIds: ['mem-3'],
    },
  });
});

test('picks the newest traced step over an older one', async () => {
  const older = tracedStep('first question', 1);
  const newer = tracedStep('second question', 2);
  H.s.db.transaction((tx) => {
    writeMemoryTrace(tx, older, { memoryTrace: trace({ teamMemoryIds: ['old'] }) });
    writeMemoryTrace(tx, newer, {
      memoryTrace: trace({ teamMemoryIds: ['new'], recalledMemoryIds: ['hit'] }),
    });
  });
  const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/memory-usage`);
  const body = (await res.json()) as ChiefMemoryUsageResponse;
  expect(body.usage?.stepId).toBe(newer);
  expect(body.usage?.teamMemoryIds).toEqual(['new']);
});

test('a traced step on another team is not returned', async () => {
  H.s.db
    .insert(chiefThread)
    .values({
      id: 'chief-foreign-thread',
      chiefId: 'chief-other',
      userId: 'user-other',
      teamId: 'team-other',
      title: 'foreign',
      sessionId: 'sess-foreign',
      sessionOpenedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  insertStepFixture(H.s.db, {
    id: 'step-foreign',
    buildId: 'chief-foreign-thread',
    kind: 'chief',
    status: 'done',
    createdAt: 9,
    memoryTrace: trace({ teamMemoryIds: ['secret'] }),
  });
  const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/memory-usage`);
  expect(((await res.json()) as ChiefMemoryUsageResponse).usage).toBeNull();
});
