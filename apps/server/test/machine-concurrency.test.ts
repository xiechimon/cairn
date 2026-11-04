import { machineRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { listSteps } from '../src/services/builds.js';
import { listChiefThreads } from '../src/services/chief.js';
import { claimStep } from '../src/services/machines.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import { bootServer, issueApiKey, postProject, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const AGENT_ID = 'agent-cap-1';

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
    .where(eq(machineTable.name, 'cap-mbp'))
    .get()!.id;
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'cap-agent',
      machineId: machineAId,
      status: 'active',
      avatarUrl: null,
      provider: 'stub-gw',
      modelId: 'stub-model',
      thinkingLevel: null,
      tools: [],
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: [],
    })
    .run();
  const projectId = await postProject(s.app, 'cap-proj');
  return { s, tokenA, machineAId, projectId };
}

async function fetchEnroll(s: TestServer, key: string): Promise<{ token: string }> {
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'cap-mbp', cliVersion: '0.1.0' }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { token: string };
}

let seqCounter = 9_000;

function insertPendingBuildStep(
  s: TestServer,
  world: World,
  opts: { agentId?: string } = {},
): { todoId: string; buildId: string; stepId: string } {
  const suffix = Math.random().toString(36).slice(2, 8);
  seqCounter += 1;
  const now = seqCounter;
  s.db
    .insert(todoTable)
    .values({
      id: `todo-cap-${suffix}`,
      teamId: s.team.id,
      projectId: world.projectId,
      seqNum: seqCounter,
      title: `并发任务 ${suffix}`,
      spec: '探针',
      phase: 'queued',
      phaseAt: now,
      assignment: { plan: null, build: { agentId: opts.agentId ?? AGENT_ID } },
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: `build-cap-${suffix}`,
      todoId: `todo-cap-${suffix}`,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: now,
    })
    .run();
  const stepId = `step-cap-${suffix}`;
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: `build-cap-${suffix}`,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt: now + 1,
    })
    .run();
  return { todoId: `todo-cap-${suffix}`, buildId: `build-cap-${suffix}`, stepId };
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

function claimAs(w: World, machineId = w.machineAId) {
  return claimStep(machineDepsOf(w), machineId, w.s.team.id, 10, 'http://localhost');
}

function setCap(w: World, cap: number): void {
  w.s.db
    .update(machineTable)
    .set({ maxConcurrent: cap })
    .where(eq(machineTable.id, w.machineAId))
    .run();
}

function insertClaimedStep(s: TestServer, machineId: string, opts: { createdAt: number }): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  const id = `step-run-${suffix}`;
  s.db
    .insert(stepTable)
    .values({
      id,
      buildId: `build-run-${suffix}`,
      kind: 'build',
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

describe('#1108 claim capacity gate (at capacity no claim / free slot claims / adjustments immediate)', () => {
  test('failure mode 1: at capacity -> claim comes up empty, step stays pending (no failure funnel)', async () => {
    const w = await setupWorld();
    setCap(w, 2);
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 4000 });
    const { stepId } = insertPendingBuildStep(w.s, w);
    const claimed = await claimAs(w);
    expect(claimed).toBeNull();
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status).toBe(
      'pending',
    );
  });

  test('failure mode 2: free slot claims (running step wraps up -> capacity gate opens)', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    const running = insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
    const { stepId } = insertPendingBuildStep(w.s, w);
    expect(await claimAs(w)).toBeNull();
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, running)).run();
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(stepId);
  });

  test('failure mode 3: lowering does not preempt -- in-flight steps as usual, new steps not claimed; raising immediate', async () => {
    const w = await setupWorld();
    setCap(w, 3);
    const running = [
      insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 }),
      insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 4000 }),
    ];
    insertPendingBuildStep(w.s, w);
    setCap(w, 2);
    expect(await claimAs(w)).toBeNull();
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, running[0]!)).run();
    expect((await claimAs(w))?.step.id).toBeTruthy();
    setCap(w, 3);
    const { stepId: step3 } = insertPendingBuildStep(w.s, w);
    expect((await claimAs(w))?.step.id).toBe(step3);
  });
});

describe('#1108 queue projection (position + waiting target + read-surface mount)', () => {
  test('failure mode 4 (#1259 home-machine version): home-machine step position only counts the same home-machine set; waitingFor snapshot', async () => {
    const w = await setupWorld();
    setCap(w, 2);
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 9000 });
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 8000 });
    const machineBId = `machine-b-${Math.random().toString(36).slice(2)}`;
    w.s.db
      .insert(machineTable)
      .values({
        id: machineBId,
        teamId: w.s.team.id,
        name: 'cap-mbp-b',
        online: true,
        enabledRuntimes: ['pi'],
        maxConcurrent: 3,
      })
      .run();
    w.s.db
      .insert(agentTable)
      .values({
        id: 'agent-cap-b',
        teamId: w.s.team.id,
        displayName: 'cap-agent-b',
        modelId: 'stub-model',
        machineId: machineBId,
      })
      .run();
    insertPendingBuildStep(w.s, w);
    const lateB = insertPendingBuildStep(w.s, w, { agentId: 'agent-cap-b' });
    const target = insertPendingBuildStep(w.s, w);
    const projector = stepQueueProjector(w.s.db, w.s.team.id);
    const targetInfo = projector.project({
      id: target.stepId,
      createdAt: Date.now(),
      homeMachineId: w.machineAId,
    });
    expect(targetInfo?.position).toBe(2);
    expect(targetInfo?.waitingFor).toMatchObject({
      machineId: w.machineAId,
      running: 2,
      capacity: 2,
    });
    const bInfo = projector.project({
      id: lateB.stepId,
      createdAt: Date.now(),
      homeMachineId: machineBId,
    });
    expect(bInfo?.position).toBe(1);
    expect(bInfo?.waitingFor).toMatchObject({ machineId: machineBId, running: 0, capacity: 3 });
  });

  test('failure mode 4b: steps query mounts queue; step claimed -> projection exits', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    const running = insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
    const { buildId, stepId } = insertPendingBuildStep(w.s, w);
    const rows = listSteps(machineDepsOf(w), buildId);
    const row = rows.find((r) => r.id === stepId);
    expect(row?.status).toBe('pending');
    expect(row?.queue).toMatchObject({ position: 1 });
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, running)).run();
    await claimAs(w);
    const after = listSteps(machineDepsOf(w), buildId).find((r) => r.id === stepId);
    expect(after?.status).toBe('claimed');
    expect(after?.queue).toBeUndefined();
  });

  test('failure mode 4c: chief threads mount turnQueue; after claimed they exit', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    const running = insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
    const now = Date.now();
    const threadId = `chief-cap-${Math.random().toString(36).slice(2, 8)}`;
    w.s.db
      .insert(chiefTable)
      .values({
        id: `chief-${w.s.user.id}-${w.s.team.id}`,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        agentId: AGENT_ID,
        charter: '',
        createdAt: now,
      })
      .run();
    w.s.db
      .insert(chiefThreadTable)
      .values({
        id: threadId,
        chiefId: `chief-${w.s.user.id}-${w.s.team.id}`,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        title: '排队线程',
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
    const chiefStepId = `step-chief-cap-${Math.random().toString(36).slice(2, 8)}`;
    w.s.db
      .insert(stepTable)
      .values({
        id: chiefStepId,
        buildId: threadId,
        kind: 'chief',
        machineId: null,
        status: 'pending',
        prompt: '帮我看看',
        createdAt: now + 1,
      })
      .run();
    const threads = listChiefThreads(
      {
        db: w.s.db,
        hub: w.s.hub,
        machineHub: w.s.machineHub,
        user: w.s.user,
      },
      w.s.team.id,
    );
    const thread = threads.find((t) => t.id === threadId);
    expect(thread?.turnQueue).toMatchObject({
      position: 1,
      waitingFor: { machineId: w.machineAId, running: 1, capacity: 1 },
    });
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, running)).run();
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(chiefStepId);
    const after = listChiefThreads(
      { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub, user: w.s.user },
      w.s.team.id,
    ).find((t) => t.id === threadId);
    expect(after?.turnQueue == null).toBe(true);
  });
});

describe('#1108 write surface and wire contract (PATCH validation / record projection / wake)', () => {
  test('failure mode 5: PATCH maxConcurrent 0 / 17 -> 400; legal value persisted + runningSteps', async () => {
    const w = await setupWorld();
    for (const bad of [0, 17]) {
      const res = await req(w.s.app, 'PATCH', `/api/machines/${w.machineAId}`, {
        maxConcurrent: bad,
      });
      expect(res.status).toBe(400);
    }
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
    const res = await req(w.s.app, 'PATCH', `/api/machines/${w.machineAId}`, {
      maxConcurrent: 5,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { maxConcurrent: number; runningSteps: number };
    expect(body.maxConcurrent).toBe(5);
    expect(body.runningSteps).toBe(1);
    const list = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/machines`);
    const rows = (await list.json()) as {
      id: string;
      maxConcurrent: number;
      runningSteps: number;
    }[];
    expect(rows.find((r) => r.id === w.machineAId)?.maxConcurrent).toBe(5);
  });

  test('failure mode 6: legacy server shape (no maxConcurrent/runningSteps fields) -> wire parse passes', () => {
    const parsed = machineRecordSchema.parse({
      id: 'm-old',
      name: 'old',
      teamId: 't-old',
      online: false,
      latestCliVersion: null,
      kind: 'remote',
      enabledRuntimes: [],
    });
    expect(parsed.maxConcurrent).toBeUndefined();
    expect(parsed.runningSteps).toBeUndefined();
  });

  test('failure mode 2b: finishStep terminal sends a team wake (free slot handover immediately)', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    const { stepId } = insertPendingBuildStep(w.s, w);
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(stepId);
    const wake = vi.spyOn(w.s.machineHub, 'wake');
    const res = await w.s.app.request(`/api/machine/done/${stepId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${w.tokenA}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'success', sessionId: 'sess-cap' }),
    });
    expect(res.status).toBe(200);
    expect(wake).toHaveBeenCalledWith(w.s.team.id);
    wake.mockRestore();
  });
});
