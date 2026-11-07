import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { build, machine, plan, step, todo } from '../src/db/schema.js';
import { bootServer, insertMachine, postProject, req, seedSessionRoute } from './helpers.js';

const REJECTED_PREFIX = 'split-proposal-rejected:v1\n';

async function world() {
  const s = bootServer();
  const machineId = insertMachine(s, { name: 'proposal-machine' });
  s.db
    .update(machine)
    .set({ online: true, enabledRuntimes: ['pi'] })
    .run();
  seedSessionRoute(s, { provider: 'pi', machineId });
  const projectId = await postProject(s.app);
  expect(
    (await req(s.app, 'PATCH', `/api/projects/${projectId}`, { splitPolicy: 'auto' })).status,
  ).toBe(200);
  const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Proposal',
    spec: 'ordinary implementation',
  });
  const { id: parentId } = (await created.json()) as { id: string };
  return {
    s,
    projectId,
    parentId,
  };
}

function seedRejected(w: Awaited<ReturnType<typeof world>>) {
  const buildId = 'rejected-build';
  w.s.db
    .insert(build)
    .values({
      id: buildId,
      todoId: w.parentId,
      withPlan: true,
      prevPhase: 'todo',
      triggerSource: 'chief',
      errorMessage: `${REJECTED_PREFIX}child dependencies are invalid`,
      createdAt: 1,
    })
    .run();
  w.s.db
    .insert(plan)
    .values({
      id: 'rejected-plan',
      buildId,
      version: 1,
      content: JSON.stringify([{ title: 'First', spec: 'ordinary first task' }]),
      createdAt: 1,
    })
    .run();
  w.s.db.update(build).set({ planDocId: 'rejected-plan' }).where(eq(build.id, buildId)).run();
  w.s.db
    .update(todo)
    .set({ phase: 'confirm', latestBuildId: buildId, hasPlan: true, lastRunAt: 1 })
    .where(eq(todo.id, w.parentId))
    .run();
  return buildId;
}

test('rejected proposal cannot be confirmed', async () => {
  const w = await world();
  try {
    const buildId = seedRejected(w);
    const response = await req(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'confirm',
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('rejected split proposal');
    expect(w.s.db.select().from(step).all()).toEqual([]);
    expect(w.s.db.select().from(todo).where(eq(todo.id, w.parentId)).get()!.phase).toBe('confirm');
  } finally {
    w.s.dispose();
  }
});

test('rejected proposal cannot bypass confirmation through an ordinary build start', async () => {
  const w = await world();
  try {
    seedRejected(w);
    expect(
      (
        await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
          todoIds: [w.parentId],
          withPlan: false,
        })
      ).status,
    ).toBe(409);
    expect(w.s.db.select().from(step).all()).toEqual([]);
    expect(w.s.db.select().from(build).all()).toHaveLength(1);
  } finally {
    w.s.dispose();
  }
});

test('rejected proposal refuses queuing a planner revision', async () => {
  const w = await world();
  try {
    const buildId = seedRejected(w);
    const response = await req(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'revision',
      side: 'plan',
      feedback: 'correct the proposal',
      clientMessageId: 'revision-1',
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('rejected split proposal');
    expect(w.s.db.select().from(step).all()).toEqual([]);
    expect(w.s.db.select().from(todo).where(eq(todo.id, w.parentId)).get()!.phase).toBe('confirm');
  } finally {
    w.s.dispose();
  }
});
