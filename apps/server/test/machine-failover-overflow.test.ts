import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  team as teamTable,
} from '../src/db/schema.js';
import { OFFLINE_FAILOVER_GRACE_MS } from '../src/services/machine-routing.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import {
  bootServer,
  insertClaudeSubscription,
  issueApiKey,
  postProject,
  req,
  seedRoute,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

function call(
  app: TestServer['app'],
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

async function enroll(s: TestServer, name: string): Promise<{ id: string; token: string }> {
  const key = await issueApiKey(s);
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({ teamId: s.team.id, name, cliVersion: '0.2.5' }),
  });
  expect(res.status).toBe(200);
  const { token } = (await res.json()) as { token: string };
  const row = s.db.select().from(machineTable).where(eq(machineTable.name, name)).get()!;
  return { id: row.id, token };
}

async function claim(app: TestServer['app'], token: string): Promise<ClaimedStep | null> {
  const res = await call(app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

async function createAndStartTodo(s: TestServer, projectId: string, spec = 'test task') {
  const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: '',
    spec,
  });
  expect(created.status).toBe(201);
  const todoId = ((await created.json()) as { id: string }).id;
  const started = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
  });
  expect(started.status).toBe(201);
  const buildId = ((await started.json()) as { builds: { id: string }[] }).builds[0]!.id;
  const stepRow = s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get()!;
  return { todoId, buildId, stepId: stepRow.id };
}

async function setupPair() {
  const s = bootServer({ claimHoldMs: 50 });
  insertClaudeSubscription(s);
  const mini = await enroll(s, 'mac-mini');
  const laptop = await enroll(s, 'macbook');
  const now = Date.now();
  s.db
    .update(machineTable)
    .set({ online: true, lastSeenAt: now })
    .where(eq(machineTable.teamId, s.team.id))
    .run();
  s.db
    .update(teamTable)
    .set({ defaultMachineId: mini.id })
    .where(eq(teamTable.id, s.team.id))
    .run();
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model', machineId: null });
  seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'stub-model', machineId: null });
  const projectId = await postProject(s.app, 'pool-proj');
  return { s, mini, laptop, projectId };
}

describe('multi-machine failover and overflow', () => {
  test('PATCH /api/machines/:id updates maxConcurrency and autoDispatch and rejects invalid input', async () => {
    const { s, mini } = await setupPair();
    const ok = await req(s.app, 'PATCH', `/api/machines/${mini.id}`, {
      maxConcurrency: 2,
      autoDispatch: false,
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { maxConcurrency: number | null; autoDispatch: boolean };
    expect(body.maxConcurrency).toBe(2);
    expect(body.autoDispatch).toBe(false);

    const bad = await req(s.app, 'PATCH', `/api/machines/${mini.id}`, { maxConcurrency: 0 });
    expect(bad.status).toBe(400);
  });

  test('worker step fails over to online backup after preferred machine is offline past grace window', async () => {
    const { s, mini, laptop, projectId } = await setupPair();
    const pastGrace = Date.now() - OFFLINE_FAILOVER_GRACE_MS - 5_000;
    s.db
      .update(machineTable)
      .set({ online: false, lastSeenAt: pastGrace })
      .where(eq(machineTable.id, mini.id))
      .run();

    const { stepId } = await createAndStartTodo(s, projectId);
    const claimed = await claim(s.app, laptop.token);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.step.machineId).toBe(laptop.id);

    const row = s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    expect(row.routedFromMachineId).toBe(mini.id);
    expect(row.routedReason).toBe('offline');
  });

  test('worker step waits during offline grace window before failing over', async () => {
    const { s, mini, laptop, projectId } = await setupPair();
    const recent = Date.now() - 2_000;
    s.db
      .update(machineTable)
      .set({ online: false, lastSeenAt: recent })
      .where(eq(machineTable.id, mini.id))
      .run();

    const { stepId } = await createAndStartTodo(s, projectId);
    const claimed = await claim(s.app, laptop.token);
    expect(claimed).toBeNull();

    const queue = stepQueueProjector(s.db, s.team.id).project({
      id: stepId,
      createdAt: Date.now(),
      homeMachineId: null,
    });
    expect(queue?.waitingFor?.machineId).toBe(mini.id);
    expect(queue?.alternateMachines).toEqual([{ machineId: laptop.id, name: 'macbook' }]);
  });

  test('worker step overflows to backup when preferred machine reaches maxConcurrency', async () => {
    const { s, mini, laptop, projectId } = await setupPair();
    await req(s.app, 'PATCH', `/api/machines/${mini.id}`, { maxConcurrency: 1 });

    const first = await createAndStartTodo(s, projectId, 'first');
    const second = await createAndStartTodo(s, projectId, 'second');

    const claimedFirst = await claim(s.app, mini.token);
    expect(claimedFirst?.step.id).toBe(first.stepId);

    const miniSecond = await claim(s.app, mini.token);
    expect(miniSecond).toBeNull();

    const laptopSecond = await claim(s.app, laptop.token);
    expect(laptopSecond?.step.id).toBe(second.stepId);
    const row = s.db.select().from(stepTable).where(eq(stepTable.id, second.stepId)).get()!;
    expect(row.routedFromMachineId).toBe(mini.id);
    expect(row.routedReason).toBe('busy');
  });

  test('backup with autoDispatch=false does not claim overflow or offline failover', async () => {
    const { s, mini, laptop, projectId } = await setupPair();
    await req(s.app, 'PATCH', `/api/machines/${laptop.id}`, { autoDispatch: false });
    const pastGrace = Date.now() - OFFLINE_FAILOVER_GRACE_MS - 5_000;
    s.db
      .update(machineTable)
      .set({ online: false, lastSeenAt: pastGrace })
      .where(eq(machineTable.id, mini.id))
      .run();

    await createAndStartTodo(s, projectId);
    expect(await claim(s.app, laptop.token)).toBeNull();
  });

  test('local-path project never auto-fails over to another machine', async () => {
    const { s, mini, laptop, projectId } = await setupPair();
    s.db
      .update(projectTable)
      .set({ repoKind: 'local', localPath: '/tmp/only-on-mini' })
      .where(eq(projectTable.id, projectId))
      .run();
    const pastGrace = Date.now() - OFFLINE_FAILOVER_GRACE_MS - 5_000;
    s.db
      .update(machineTable)
      .set({ online: false, lastSeenAt: pastGrace })
      .where(eq(machineTable.id, mini.id))
      .run();

    const { stepId } = await createAndStartTodo(s, projectId);
    expect(await claim(s.app, laptop.token)).toBeNull();

    const queue = stepQueueProjector(s.db, s.team.id).project({
      id: stepId,
      createdAt: Date.now(),
      homeMachineId: null,
    });
    expect(queue?.lockReason).toBe('local-project');
    expect(queue?.alternateMachines).toBeUndefined();
  });

  test('chief step fails over after grace window and supports manual switch-machine during grace', async () => {
    const { s, mini, laptop } = await setupPair();
    const chiefRow = s.db
      .insert(chiefTable)
      .values({
        id: 'chief-1',
        teamId: s.team.id,
        userId: s.user.id,
        createdAt: Date.now(),
      })
      .returning()
      .get();
    const threadRow = s.db
      .insert(chiefThreadTable)
      .values({
        id: 'chief-thread-1',
        teamId: s.team.id,
        userId: s.user.id,
        chiefId: chiefRow.id,
        title: 'Chief',
        sessionId: '',
        sessionOpenedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returning()
      .get();

    const recent = Date.now() - 1_000;
    s.db
      .update(machineTable)
      .set({ online: false, lastSeenAt: recent })
      .where(eq(machineTable.id, mini.id))
      .run();

    const pendingStep = s.db
      .insert(stepTable)
      .values({
        id: 'chief-step-1',
        buildId: threadRow.id,
        kind: 'chief',
        status: 'pending',
        prompt: 'hello',
        createdAt: Date.now(),
      })
      .returning()
      .get();

    const swOffline = await req(
      s.app,
      'POST',
      `/api/chief/steps/${pendingStep.id}/switch-machine`,
      {
        machineId: mini.id,
      },
    );
    expect(swOffline.status).toBe(409);

    const swOk = await req(s.app, 'POST', `/api/chief/steps/${pendingStep.id}/switch-machine`, {
      machineId: laptop.id,
    });
    expect(swOk.status).toBe(200);

    const claimed = await claim(s.app, laptop.token);
    expect(claimed?.step.id).toBe(pendingStep.id);
    expect(claimed?.step.machineId).toBe(laptop.id);
  });
});
