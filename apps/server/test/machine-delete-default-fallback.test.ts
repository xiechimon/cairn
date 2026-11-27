import type { ClaimedStep, MachineHardware } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  machine as machineTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  resolveChiefCandidates,
  resolveWorkerCandidates,
} from '../src/services/machine-routing.js';
import { seedLocalMachine } from '../src/services/machines.js';
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

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

const CALM: MachineHardware = {
  cpuCores: 8,
  memoryTotalMb: 16_384,
  memoryAvailableMb: 8_000,
  loadAvg1: 1.2,
  cpuUtilization: 0.1,
  memoryPressure: 0.4,
  diskFreeMb: 100_000,
};

const STRAINED: MachineHardware = {
  ...CALM,
  cpuUtilization: 0.96,
};

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

async function enroll(
  s: TestServer,
  name: string,
  opts: { online?: boolean } = {},
): Promise<{ id: string; token: string }> {
  const key = await issueApiKey(s);
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({ teamId: s.team.id, name, cliVersion: '0.2.5' }),
  });
  expect(res.status).toBe(200);
  const { machineId, token } = (await res.json()) as { machineId: string; token: string };
  s.db
    .update(machineTable)
    .set({ online: opts.online ?? true, lastSeenAt: Date.now() })
    .where(eq(machineTable.id, machineId))
    .run();
  return { id: machineId, token };
}

async function claim(app: TestServer['app'], token: string): Promise<ClaimedStep | null> {
  const res = await call(app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

function defaultMachineOf(s: TestServer): string | null {
  return (
    s.db.select().from(teamTable).where(eq(teamTable.id, s.team.id)).get()?.defaultMachineId ?? null
  );
}

function setHardware(s: TestServer, machineId: string, hardware: MachineHardware): void {
  const row = s.db.select().from(machineTable).where(eq(machineTable.id, machineId)).get();
  if (!row?.capabilities) throw new Error(`missing machine ${machineId}`);
  s.db
    .update(machineTable)
    .set({ capabilities: { ...row.capabilities, hardware } })
    .where(eq(machineTable.id, machineId))
    .run();
}

function insertRunningStep(s: TestServer, projectId: string, machineId: string, tag: string): void {
  const now = Date.now();
  s.db
    .insert(todoTable)
    .values({
      id: `todo-${tag}`,
      teamId: s.team.id,
      projectId,
      seqNum: Math.floor(Math.random() * 100_000) + 1000,
      title: tag,
      spec: tag,
      phase: 'building',
      phaseAt: now,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: `build-${tag}`,
      todoId: `todo-${tag}`,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: now,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: `step-${tag}`,
      buildId: `build-${tag}`,
      kind: 'build',
      machineId,
      status: 'claimed',
      prompt: null,
      freshSession: false,
      createdAt: now,
    })
    .run();
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

describe('DELETE /api/machines/:id default Runner reassignment', () => {
  test('deleting the default machine with 2+ remaining online machines promotes an online machine by id and keeps new steps claimable', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    servers.push(s);
    insertClaudeSubscription(s);
    const first = await enroll(s, 'runner-default');
    const second = await enroll(s, 'runner-b');
    const third = await enroll(s, 'runner-c');
    seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model', machineId: null });
    seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'stub-model', machineId: null });
    const projectId = await postProject(s.app, 'reassign-proj');

    expect(defaultMachineOf(s)).toBe(first.id);

    const delRes = await call(s.app, 'DELETE', `/api/machines/${first.id}`);
    expect(delRes.status).toBe(204);

    const expectedNext = [second.id, third.id].sort()[0]!;
    expect(defaultMachineOf(s)).toBe(expectedNext);

    const { stepId } = await createAndStartTodo(s, projectId, 'work after default delete');
    const winner = expectedNext === second.id ? second : third;
    const claimed = await claim(s.app, winner.token);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.step.machineId).toBe(winner.id);
  });

  test('deleting the default machine prefers online over offline, ignores retired and unregistered machines, and falls back to null when none remain', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    servers.push(s);
    seedLocalMachine(s.db, s.team.id);
    const first = await enroll(s, 'runner-1');
    const offline = await enroll(s, 'runner-2', { online: false });
    const retired = await enroll(s, 'runner-3', { online: true });
    s.db
      .update(machineTable)
      .set({ retiredAt: Date.now() })
      .where(eq(machineTable.id, retired.id))
      .run();

    expect(defaultMachineOf(s)).toBe(first.id);

    expect((await call(s.app, 'DELETE', `/api/machines/${first.id}`)).status).toBe(204);
    expect(defaultMachineOf(s)).toBe(offline.id);

    expect((await call(s.app, 'DELETE', `/api/machines/${offline.id}`)).status).toBe(204);
    expect(defaultMachineOf(s)).toBeNull();
  });

  test('deleting a non-default machine leaves defaultMachineId unchanged', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    servers.push(s);
    const first = await enroll(s, 'runner-1');
    const second = await enroll(s, 'runner-2');

    expect(defaultMachineOf(s)).toBe(first.id);
    expect((await call(s.app, 'DELETE', `/api/machines/${second.id}`)).status).toBe(204);
    expect(defaultMachineOf(s)).toBe(first.id);
  });
});

describe('poolResolution when defaultMachineId is null', () => {
  test('resolveWorkerCandidates ranks calm, least-loaded online machines instead of returning empty claimableIds', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    servers.push(s);
    insertClaudeSubscription(s);
    const projectId = await postProject(s.app, 'null-default-proj');

    const strained = await enroll(s, 'strained');
    const busy = await enroll(s, 'busy');
    const idleB = await enroll(s, 'idle-b');
    const idleA = await enroll(s, 'idle-a');

    setHardware(s, strained.id, STRAINED);
    setHardware(s, busy.id, CALM);
    setHardware(s, idleB.id, CALM);
    setHardware(s, idleA.id, CALM);
    insertRunningStep(s, projectId, busy.id, 'busy-1');
    insertRunningStep(s, projectId, busy.id, 'busy-2');

    s.db.update(teamTable).set({ defaultMachineId: null }).where(eq(teamTable.id, s.team.id)).run();

    const teamMachines = s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.teamId, s.team.id))
      .all();

    const resolution = resolveWorkerCandidates({
      db: s.db,
      teamId: s.team.id,
      teamMachines,
      facts: {
        agentRow: { machineId: null, requiredCapabilities: null },
        model: { provider: 'stub-gw', modelId: 'stub-model' },
        localProject: false,
        localMerge: false,
        githubPushRepo: null,
      },
      catalog: [],
      sessionMachineId: null,
      explicitOverrideMachineId: null,
      ruleMachineId: null,
      defaultMachineId: null,
      stepCreatedAt: Date.now(),
      now: Date.now(),
    });

    const idleSorted = [idleA.id, idleB.id].sort();
    expect(resolution.waitingForId).toBeNull();
    expect(resolution.claimableIds).toEqual([...idleSorted, busy.id, strained.id]);
  });

  test('resolveChiefCandidates with null defaultMachineId returns ranked claimable online machines', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    servers.push(s);
    insertClaudeSubscription(s);

    const m1 = await enroll(s, 'chief-1');
    const m2 = await enroll(s, 'chief-2');
    setHardware(s, m1.id, STRAINED);
    setHardware(s, m2.id, CALM);

    s.db.update(teamTable).set({ defaultMachineId: null }).where(eq(teamTable.id, s.team.id)).run();

    const teamMachines = s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.teamId, s.team.id))
      .all();

    const resolution = resolveChiefCandidates({
      db: s.db,
      teamId: s.team.id,
      teamMachines,
      pinnedMachineId: null,
      targetMachineId: null,
      agentRow: { requiredCapabilities: null },
      provider: 'stub-gw',
      stepCreatedAt: Date.now(),
      now: Date.now(),
    });

    expect(resolution.waitingForId).toBeNull();
    expect(resolution.claimableIds).toEqual([m2.id, m1.id]);
  });
});
