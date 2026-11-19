import { type MachineHardware, type MachineStrainReason, machineRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { listSteps } from '../src/services/builds.js';
import { listChiefThreads } from '../src/services/chief.js';
import { claimStep, markPresence, reportActivity, reportTool } from '../src/services/machines.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import { toTodoRecord } from '../src/services/todos.js';
import {
  bootServer,
  issueApiKey,
  postProject,
  req,
  seedRoute,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

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
  s.db.update(machineTable).set({ online: true }).where(eq(machineTable.id, machineAId)).run();
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model', machineId: machineAId });
  seedRoute(s, 'coordinator', {
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId: machineAId,
  });
  const projectId = await postProject(s.app, 'cap-proj');
  return { s, tokenA, machineAId, projectId };
}

async function fetchEnroll(s: TestServer, key: string): Promise<{ token: string }> {
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(readyMachine({ teamId: s.team.id, name: 'cap-mbp', cliVersion: '0.1.0' })),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { token: string };
}

let seqCounter = 9_000;

function insertPendingBuildStep(
  s: TestServer,
  world: World,
  opts: { machineId?: string } = {},
): { todoId: string; buildId: string; stepId: string } {
  const suffix = Math.random().toString(36).slice(2, 8);
  seqCounter += 1;
  const now = Date.now() - 60_000 + (seqCounter - 9_000);
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
      ...(opts.machineId === undefined ? {} : { routeOverride: { machineId: opts.machineId } }),
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
      .values(
        readyMachine({
          id: machineBId,
          teamId: w.s.team.id,
          name: 'cap-mbp-b',
          online: true,
          maxConcurrent: 3,
        }),
      )
      .run();
    insertPendingBuildStep(w.s, w);
    const lateB = insertPendingBuildStep(w.s, w, { machineId: machineBId });
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

const CALM: MachineHardware = {
  cpuCores: 8,
  memoryTotalMb: 16_384,
  memoryAvailableMb: 8_000,
  loadAvg1: 2,
  loadAvg5: 2,
  diskFreeMb: 100_000,
};

function setHardware(w: World, hardware: MachineHardware): void {
  const row = w.s.db.select().from(machineTable).where(eq(machineTable.id, w.machineAId)).get()!;
  w.s.db
    .update(machineTable)
    .set({ capabilities: { ...row.capabilities!, hardware } })
    .where(eq(machineTable.id, w.machineAId))
    .run();
}

function pendingTask(w: World) {
  const ids = insertPendingBuildStep(w.s, w);
  w.s.db
    .update(todoTable)
    .set({ latestBuildId: ids.buildId })
    .where(eq(todoTable.id, ids.todoId))
    .run();
  return ids;
}

function todoRowOf(w: World, todoId: string) {
  return w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
}

async function machineListRow(w: World) {
  const res = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/machines`);
  const rows = machineRecordSchema.array().parse(await res.json());
  return rows.find((r) => r.id === w.machineAId)!;
}

describe('machine strain never holds a task (mon X 2026-11-19)', () => {
  const strained: [string, Partial<MachineHardware>, MachineStrainReason][] = [
    ['memory below 10% available', { memoryAvailableMb: 1_500 }, 'memory'],
    ['5-minute load above the core count', { loadAvg5: 9.5 }, 'load'],
    ['disk below 5 GB free', { diskFreeMb: 4_000 }, 'disk'],
  ];
  for (const [label, patch, reason] of strained) {
    test(`${label}: a busy computer under its cap still starts the next task`, async () => {
      const w = await setupWorld();
      setCap(w, 4);
      setHardware(w, { ...CALM, ...patch });
      insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
      const { stepId, todoId } = pendingTask(w);
      expect(toTodoRecord(w.s.svc, todoRowOf(w, todoId)).waitingOn).toBeUndefined();
      expect((await claimAs(w))?.step.id).toBe(stepId);
      expect((await machineListRow(w)).strain).toEqual([reason]);
    });
  }

  test('a full computer says capacity', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    setHardware(w, { ...CALM, memoryAvailableMb: 200 });
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
    const { todoId } = pendingTask(w);
    expect(toTodoRecord(w.s.svc, todoRowOf(w, todoId)).waitingOn).toEqual({
      on: 'capacity',
      retryAt: null,
    });
    expect((await machineListRow(w)).queued).toEqual([
      expect.objectContaining({ threadId: todoId, reason: 'capacity' }),
    ]);
  });

  test('a calm computer with a free slot reports no queue reason', async () => {
    const w = await setupWorld();
    setCap(w, 3);
    setHardware(w, CALM);
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
    const { todoId } = pendingTask(w);
    expect(toTodoRecord(w.s.svc, todoRowOf(w, todoId)).waitingOn).toBeUndefined();
    const listed = await machineListRow(w);
    expect(listed.strain).toEqual([]);
    expect(listed.queued).toEqual([
      expect.objectContaining({ threadId: todoId, reason: 'waiting' }),
    ]);
  });
});

describe('step last progress (docs/design/runner-strain-and-progress.md)', () => {
  async function running(w: World) {
    setCap(w, 3);
    const { stepId, todoId } = pendingTask(w);
    expect((await claimAs(w))?.step.id).toBe(stepId);
    const read = () => w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    const setProgress = (at: number | null) =>
      w.s.db.update(stepTable).set({ lastProgressAt: at }).where(eq(stepTable.id, stepId)).run();
    return { stepId, todoId, read, setProgress };
  }

  test('a running task counts from its claim until it reports progress', async () => {
    const w = await setupWorld();
    const r = await running(w);
    expect(r.read().lastProgressAt).toBeNull();
    const record = toTodoRecord(w.s.svc, todoRowOf(w, r.todoId));
    expect(record.lastProgressAt).toBe(r.read().claimedAt);
    expect((await machineListRow(w)).running?.[0]?.lastProgressAt).toBe(r.read().claimedAt);
  });

  test('waiting on the model or retrying is not progress; thinking and tool calls are', async () => {
    const w = await setupWorld();
    const r = await running(w);
    const deps = machineDepsOf(w);
    reportActivity(deps, w.machineAId, r.stepId, { phase: 'awaiting_model' });
    reportActivity(deps, w.machineAId, r.stepId, { phase: 'retrying', attempt: 2 });
    expect(r.read().lastProgressAt).toBeNull();
    const before = Date.now();
    reportActivity(deps, w.machineAId, r.stepId, { phase: 'thinking' });
    expect(r.read().lastProgressAt).toBeGreaterThanOrEqual(before);
    r.setProgress(1_000);
    reportTool(deps, w.machineAId, r.stepId, {
      id: `call-${r.stepId}`,
      name: 'bash',
      arguments: { command: 'ls' },
      startedAt: before,
      endedAt: before + 10,
    });
    expect(r.read().lastProgressAt).toBeGreaterThanOrEqual(before);
    expect(toTodoRecord(w.s.svc, todoRowOf(w, r.todoId)).lastProgressAt).toBe(
      r.read().lastProgressAt,
    );
  });

  test('progress writes at most once per 30 seconds per step', async () => {
    const w = await setupWorld();
    const r = await running(w);
    const deps = machineDepsOf(w);
    const recent = Date.now() - 10_000;
    r.setProgress(recent);
    reportActivity(deps, w.machineAId, r.stepId, { phase: 'responding' });
    expect(r.read().lastProgressAt).toBe(recent);
    const stale = Date.now() - 31_000;
    r.setProgress(stale);
    reportActivity(deps, w.machineAId, r.stepId, { phase: 'responding' });
    expect(r.read().lastProgressAt).toBeGreaterThan(stale);
  });
});

describe('strain changes reach subscribed clients', () => {
  test('presence publishes machine_presence when strain starts and clears, not on an unchanged report', async () => {
    const w = await setupWorld();
    setHardware(w, CALM);
    const events: object[] = [];
    w.s.hub.subscribe(w.s.team.id, {
      nextSeq: () => 1,
      send: async (event: object) => {
        events.push(event);
      },
    });
    const capabilities = w.s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.id, w.machineAId))
      .get()!.capabilities!;
    const report = (hardware: MachineHardware) =>
      markPresence(machineDepsOf(w), w.machineAId, { capabilities: { ...capabilities, hardware } });
    report({ ...CALM, memoryAvailableMb: 7_000 });
    expect(events).toEqual([]);
    report({ ...CALM, memoryAvailableMb: 900 });
    report({ ...CALM, memoryAvailableMb: 800 });
    report(CALM);
    expect(events).toEqual([
      { type: 'machine_presence', machineId: w.machineAId, online: true },
      { type: 'machine_presence', machineId: w.machineAId, online: true },
    ]);
  });
});
