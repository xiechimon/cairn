import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { build, machine, step, todo } from '../src/db/schema.js';
import { enqueueStep } from '../src/services/builds.js';
import { bootServer, issueApiKey, req, seedSessionRoute, type TestServer } from './helpers.js';

let s: TestServer;
let token: string;

async function enroll(name: string): Promise<string> {
  const key = await issueApiKey(s);
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(readyMachine({ teamId: s.team.id, name, cliVersion: '0.1.0' })),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

async function claim(
  as: string = token,
): Promise<{ id: string; projectId: string | undefined } | null> {
  const res = await s.app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${as}`, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: unknown };
  if (body.step === null) return null;
  const parsed = claimedStepSchema.parse(body.step);
  return { id: parsed.step.id, projectId: parsed.project?.id };
}

async function createProject(name: string, maxConcurrent?: number | null): Promise<string> {
  const res = await req(s.app, 'POST', '/api/projects', { name });
  const { id } = (await res.json()) as { id: string };
  if (maxConcurrent !== undefined) {
    const patched = await req(s.app, 'PATCH', `/api/projects/${id}`, { maxConcurrent });
    expect(patched.status).toBe(200);
  }
  return id;
}

async function startBuild(projectId: string, title: string): Promise<string> {
  const task = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title, spec: title })
  ).json()) as { id: string };
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [task.id],
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
}

beforeEach(async () => {
  s = bootServer();
  token = await enroll('cc-builder');
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model' });
});

describe('project concurrency (D74 P4)', () => {
  test('maxConcurrent is stored and returned, and null removes the limit', async () => {
    const id = await createProject('serial', 1);
    expect(await (await req(s.app, 'GET', '/api/projects')).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, maxConcurrent: 1 })]),
    );
    const cleared = await req(s.app, 'PATCH', `/api/projects/${id}`, { maxConcurrent: null });
    expect(await cleared.json()).not.toHaveProperty('maxConcurrent');
    const bad = await req(s.app, 'PATCH', `/api/projects/${id}`, { maxConcurrent: 0 });
    expect(bad.status).toBe(400);
  });

  test('a serial project runs one thread at a time while other projects keep going', async () => {
    const serial = await createProject('serial', 1);
    const open = await createProject('open');
    await startBuild(serial, 'first');
    await startBuild(serial, 'second');
    await startBuild(open, 'elsewhere');
    const first = await claim();
    expect(first?.projectId).toBe(serial);
    const next = await claim();
    expect(next?.projectId).toBe(open);
    expect(await claim()).toBeNull();
  });

  test('a person message to a full project takes one reserved slot and goes first', async () => {
    const serial = await createProject('serial', 1);
    await startBuild(serial, 'first');
    const queuedBuild = await startBuild(serial, 'second');
    expect((await claim())?.projectId).toBe(serial);
    const humanStep = enqueueStep(
      { db: s.db, hub: s.hub, machineHub: s.machineHub, user: s.user },
      queuedBuild,
      'build',
      s.team.id,
      'please also update the docs',
      false,
      true,
    );
    const reserved = await claim();
    expect(reserved?.id).toBe(humanStep.id);
    expect(await claim()).toBeNull();
    expect(s.db.select().from(step).where(eq(step.id, humanStep.id)).get()?.byPerson).toBe(true);
  });

  test('restarting a failed thread in a full project counts as a person message', async () => {
    const serial = await createProject('serial', 1);
    await startBuild(serial, 'first');
    const failedBuild = await startBuild(serial, 'second');
    expect((await claim())?.projectId).toBe(serial);
    s.db.update(step).set({ status: 'failed' }).where(eq(step.buildId, failedBuild)).run();
    const todoId = s.db.select().from(build).where(eq(build.id, failedBuild)).get()!.todoId;
    s.db.update(todo).set({ phase: 'failed' }).where(eq(todo.id, todoId)).run();
    const restarted = await req(s.app, 'POST', `/api/builds/${failedBuild}/steps`, {
      action: 'restart',
      feedback: 'try again with the fix',
      clientMessageId: 'restart-1',
    });
    expect(restarted.status).toBe(202);
    const restartStep = s.db
      .select()
      .from(step)
      .all()
      .find((row) => row.status === 'pending');
    expect(restartStep?.byPerson).toBe(true);
    expect((await claim())?.id).toBe(restartStep?.id);
  });

  test('two machines claiming different steps of a serial project at once admit only one', async () => {
    const serial = await createProject('serial', 1);
    await startBuild(serial, 'first');
    await startBuild(serial, 'second');
    const otherToken = await enroll('cc-builder-2');
    const home = s.db.select().from(machine).where(eq(machine.name, 'cc-builder')).get();
    const other = s.db.select().from(machine).where(eq(machine.name, 'cc-builder-2')).get();
    const tasks = s.db.select().from(todo).where(eq(todo.projectId, serial)).all();
    s.db
      .update(todo)
      .set({ routeOverride: { machineId: home!.id } })
      .where(eq(todo.id, tasks[0]!.id))
      .run();
    s.db
      .update(todo)
      .set({ routeOverride: { machineId: other!.id } })
      .where(eq(todo.id, tasks[1]!.id))
      .run();
    const results = await Promise.all([claim(), claim(otherToken)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(
      s.db
        .select()
        .from(step)
        .all()
        .filter((row) => row.status === 'claimed' && row.kind === 'session'),
    ).toHaveLength(1);
  });
});
