import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { notification, step } from '../src/db/schema.js';
import { finishStep } from '../src/services/machines.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { insertMachine, req } from './helpers.js';

registerChiefHarness();

test('context length failure ends orchestration and exposes its reason on the thread API', async () => {
  const created = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, {
    title: 'context test',
    spec: 's',
  });
  expect(created.status).toBe(201);
  const todo = (await created.json()) as { id: string };
  const started = await req(H.s.app, 'POST', `/api/todos/${todo.id}/orchestrate`);
  expect(started.status).toBe(201);
  const { thread } = (await started.json()) as { thread: { id: string } };
  const pending = H.s.db.select().from(step).where(eq(step.buildId, thread.id)).get()!;
  const machineId = insertMachine(H.s);
  H.s.db.update(step).set({ status: 'claimed', machineId }).where(eq(step.id, pending.id)).run();
  const errorMessage = '400 context_length_exceeded: maximum context length is 200000 tokens';
  const events: object[] = [];
  const unsubscribe = H.s.hub.subscribe(H.teamId, {
    nextSeq: () => 1,
    send: async (event) => {
      events.push(event);
    },
  });
  await finishStep(
    {
      ...H.s.svc,
      box: H.s.secretBox,
      reposDir: H.s.reposDir,
      attachmentsDir: H.s.attachmentsDir,
      skillsDir: H.s.skillsDir,
    },
    machineId,
    pending.id,
    { status: 'failed', errorMessage },
  );
  unsubscribe();
  expect(events).toEqual([]);
  expect(H.s.db.select().from(notification).all()).toEqual([]);
  const response = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/threads`);
  expect(response.status).toBe(200);
  const threads = (await response.json()) as {
    id: string;
    activeRun: unknown;
    turnQueue: unknown;
    lastTurnError?: string;
  }[];
  expect(threads.find((item) => item.id === thread.id)).toMatchObject({
    activeRun: null,
    turnQueue: null,
    lastTurnError: errorMessage,
  });
});
