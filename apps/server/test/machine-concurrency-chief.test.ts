import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { listChiefThreads } from '../src/services/chief.js';
import { claimStep } from '../src/services/machines.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import { bootServer, issueApiKey, postProject, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const AGENT_ID = 'agent-chief-cap-1';

interface World {
  s: TestServer;
  tokenA: string;
  machineAId: string;
  projectId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 100 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const res = await fetchEnroll(s, key);
  const tokenA = res.token;
  const machineAId = s.db
    .select()
    .from(machineTable)
    .where(eq(machineTable.name, 'chief-cap-mbp'))
    .get()!.id;
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'chief-cap-agent',
      machineId: machineAId,
      status: 'active',
      avatarUrl: null,
      provider: 'stub-gw',
      modelId: 'stub-model',
      thinkingLevel: null,
      tools: [],
      secrets: [],
      skillsAllowlist: null,
      mcpServers: [],
    })
    .run();
  const projectId = await postProject(s.app, 'chief-cap-proj');
  return { s, tokenA, machineAId, projectId };
}

async function fetchEnroll(s: TestServer, key: string): Promise<{ token: string }> {
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'chief-cap-mbp', cliVersion: '0.1.0' }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { token: string };
}

let seqCounter = 9_500;

function insertPendingBuildStep(s: TestServer, world: World): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  seqCounter += 1;
  const now = seqCounter;
  s.db
    .insert(todoTable)
    .values({
      id: `todo-cc-${suffix}`,
      teamId: s.team.id,
      projectId: world.projectId,
      seqNum: seqCounter,
      title: `并发任务 ${suffix}`,
      spec: '探针',
      phase: 'queued',
      phaseAt: now,
      assignment: { plan: null, build: { agentId: AGENT_ID } },
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: `build-cc-${suffix}`,
      todoId: `todo-cc-${suffix}`,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: now,
    })
    .run();
  const stepId = `step-cc-${suffix}`;
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: `build-cc-${suffix}`,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt: now + 1,
    })
    .run();
  return stepId;
}

function insertClaimedStep(
  s: TestServer,
  machineId: string,
  opts: { createdAt: number; kind?: 'build' | 'chief' },
): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  const id = `step-run-${suffix}`;
  s.db
    .insert(stepTable)
    .values({
      id,
      buildId: `build-run-${suffix}`,
      kind: opts.kind ?? 'build',
      machineId,
      status: 'claimed',
      prompt: null,
      freshSession: false,
      createdAt: opts.createdAt,
      claimedAt: opts.createdAt,
      lastHeartbeatAt: opts.createdAt,
    })
    .run();
  return id;
}

function insertPendingChiefStep(s: TestServer, opts: { createdAt?: number } = {}): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  const threadId = `chief-cc-${suffix}`;
  const now = opts.createdAt ?? Date.now();
  if (
    s.db
      .select()
      .from(chiefTable)
      .where(eq(chiefTable.id, `chief-${s.svc.user.id}-${s.team.id}`))
      .get() === undefined
  ) {
    s.db
      .insert(chiefTable)
      .values({
        id: `chief-${s.svc.user.id}-${s.team.id}`,
        userId: s.svc.user.id,
        teamId: s.team.id,
        agentId: AGENT_ID,
        charter: '',
        createdAt: now,
      })
      .run();
  }
  s.db
    .insert(chiefThreadTable)
    .values({
      id: threadId,
      chiefId: `chief-${s.svc.user.id}-${s.team.id}`,
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: '并发探针线程',
      createdAt: now,
      updatedAt: now,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: now,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: { phase: 'chief' },
    })
    .run();
  const stepId = `step-chief-cc-${suffix}`;
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: threadId,
      kind: 'chief',
      machineId: null,
      status: 'pending',
      prompt: '帮我看看',
      createdAt: now + 1,
    })
    .run();
  return stepId;
}

function machineDepsOf(w: World) {
  return {
    ...w.s.svc,
    box: w.s.secretBox,
    reposDir: w.s.reposDir,
    attachmentsDir: w.s.attachmentsDir,
    skillsDir: w.s.skillsDir,
  };
}

function claimAs(w: World, opts: { maxWorkers?: number } = {}) {
  return claimStep(
    machineDepsOf(w),
    w.machineAId,
    w.s.team.id,
    10,
    'http://localhost',
    undefined,
    opts.maxWorkers !== undefined ? { maxWorkers: opts.maxWorkers } : undefined,
  );
}

function setCap(w: World, cap: number): void {
  w.s.db
    .update(machineTable)
    .set({ maxConcurrent: cap })
    .where(eq(machineTable.id, w.machineAId))
    .run();
}

describe('#1260 chief steps occupy concurrency slots (capacity gate)', () => {
  test('failure mode 1: at capacity (running workers fill it) -> chief comes up empty, step stays pending', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
    const chiefStepId = insertPendingChiefStep(w.s, { createdAt: Date.now() - 4000 });
    expect(await claimAs(w)).toBeNull();
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, chiefStepId)).get()!.status).toBe(
      'pending',
    );
  });

  test('failure mode 2: only running chiefs fill it (cap 1) -> worker comes up empty', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000, kind: 'chief' });
    const workerStepId = insertPendingBuildStep(w.s, w);
    expect(await claimAs(w)).toBeNull();
    expect(
      w.s.db.select().from(stepTable).where(eq(stepTable.id, workerStepId)).get()!.status,
    ).toBe('pending');
  });

  test('failure mode 4: gate open FIFO order preserved with zero drift (chief earlier -> chief first; worker earlier -> worker first)', async () => {
    const w = await setupWorld();
    setCap(w, 4);
    const olderChief = insertPendingChiefStep(w.s, { createdAt: 1_000 });
    const worker = insertPendingBuildStep(w.s, w);
    const first = await claimAs(w);
    expect(first?.step.id).toBe(olderChief);
    expect((await claimAs(w))?.step.id).toBe(worker);
    const worker2 = insertPendingBuildStep(w.s, w);
    const worker2At = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, worker2))
      .get()!.createdAt;
    const newerChief = insertPendingChiefStep(w.s, { createdAt: worker2At + 1 });
    expect((await claimAs(w))?.step.id).toBe(worker2);
    expect((await claimAs(w))?.step.id).toBe(newerChief);
  });
});

describe('#1260 read-surface semantics (runningSteps includes running chiefs)', () => {
  test('failure mode 3: me / machine list runningSteps includes chief', async () => {
    const w = await setupWorld();
    setCap(w, 3);
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000, kind: 'chief' });
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 4000 });
    const me = await w.s.app.request('/api/machine/me', {
      headers: { authorization: `Bearer ${w.tokenA}` },
    });
    const meBody = (await me.json()) as { maxConcurrent: number; runningSteps: number };
    expect(meBody.runningSteps).toBe(2);
    const list = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/machines`);
    const rows = (await list.json()) as { id: string; runningSteps?: number }[];
    expect(rows.find((r) => r.id === w.machineAId)?.runningSteps).toBe(2);
  });

  test('failure mode 3b: waitingFor.running includes chief (queue projection)', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000, kind: 'chief' });
    const target = insertPendingBuildStep(w.s, w);
    const projector = stepQueueProjector(w.s.db, w.s.team.id);
    const info = projector.project({
      id: target,
      createdAt: Date.now(),
      homeMachineId: w.machineAId,
    });
    expect(info?.waitingFor).toMatchObject({
      machineId: w.machineAId,
      running: 1,
      capacity: 1,
    });
  });

  test('failure mode 3c: chief thread leaves turnQueue after being claimed (current behavior zero drift)', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    const chiefStepId = insertPendingChiefStep(w.s, { createdAt: Date.now() });
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(chiefStepId);
    const threads = listChiefThreads(
      {
        db: w.s.db,
        hub: w.s.hub,
        machineHub: w.s.machineHub,
        user: w.s.svc.user,
      },
      w.s.team.id,
    );
    expect(threads.every((t) => t.turnQueue == null)).toBe(true);
  });
});

describe('#1148/#1260 claim body maxWorkers (env fallback server consumption surface)', () => {
  test('failure mode 5: DB 3 / body 1, 1 worker running -> worker and chief both gated', async () => {
    const w = await setupWorld();
    setCap(w, 3);
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
    const workerStepId = insertPendingBuildStep(w.s, w);
    expect(await claimAs(w, { maxWorkers: 1 })).toBeNull();
    expect(
      w.s.db.select().from(stepTable).where(eq(stepTable.id, workerStepId)).get()!.status,
    ).toBe('pending');
    const chiefStepId = insertPendingChiefStep(w.s, { createdAt: Date.now() - 4000 });
    expect(await claimAs(w, { maxWorkers: 1 })).toBeNull();
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, chiefStepId)).get()!.status).toBe(
      'pending',
    );
  });

  test('failure mode 5b: body absent (legacy daemon) = only the DB row', async () => {
    const w = await setupWorld();
    setCap(w, 2);
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
    const stepId = insertPendingBuildStep(w.s, w);
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(stepId);
  });

  test('failure mode 6: maxWorkers 0 -> 400', async () => {
    const w = await setupWorld();
    const res = await w.s.app.request('/api/machine/tasks/claim', {
      method: 'POST',
      headers: { authorization: `Bearer ${w.tokenA}`, 'content-type': 'application/json' },
      body: JSON.stringify({ maxWorkers: 0 }),
    });
    expect(res.status).toBe(400);
  });
});
