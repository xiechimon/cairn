// #1148 chief 步不占并发槽（server 面）：容量闸、读面 runningSteps、排队投影
// 与 claim body maxWorkers（env 兜底的 server 消费面）。失败方式（先于实现
// 固化）：
// 1. chief 饿死回归：满载（非 chief claimed ≥ maxConcurrent）时 chief 步
//    照领——闸只挡 worker 候选。
// 2. chief 占位回归：仅 chief 在跑的机器满载不发 worker 步——chief 步不
//    占槽，worker 照领。
// 3. 读面口径：runningSteps（me / machines 列表 / waitingFor.running）只数
//    非 chief claimed 步——chief 在跑不计入「执行中 n/N」的 n。
// 4. FIFO 保序（闸开时不变）：chief 候选晚于最早 worker 候选 → worker 先
//    领；chief 更早 → chief 先领（现行行为零漂移）。
// 5. claim body maxWorkers（#1148 env 兜底的 server 侧）：DB 3 / body 1、
//    1 worker 在跑 → worker 不发（min(DB, body) 闸），chief 照发；body 缺席
//    （老 daemon）= 只按 DB 行。
// 6. body 校验：maxWorkers 0 → 400。

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

/** seq 单调计数（todo.seqNum 团队内唯一 + createdAt 排队位次单调）。 */
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

/** 建线程 + pending chief 回合步（直插——sendChiefMessage 面归 chief.test）。 */
function insertPendingChiefStep(
  s: TestServer,
  opts: { createdAt?: number; pin?: string | null } = {},
): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  const threadId = `chief-cc-${suffix}`;
  const now = opts.createdAt ?? Date.now();
  // chief 行（每 world 一条）：同 world 二次插入幂等（PK 固定）。
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

describe('#1148 chief 步不占并发槽（容量闸）', () => {
  test('失败方式 1：满载 worker 时 chief 照领——闸只挡 worker', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    // 占满唯一槽（worker claimed）。
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
    const chiefStepId = insertPendingChiefStep(w.s, { createdAt: Date.now() - 4000 });
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(chiefStepId); // chief 不被 worker 满载饿死
    expect(claimed?.step.kind).toBe('chief');
  });

  test('失败方式 2：仅 chief 在跑 → 槽不算占用，worker 照领', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    // 唯一在跑步是 chief——不占 worker 槽。
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000, kind: 'chief' });
    const workerStepId = insertPendingBuildStep(w.s, w);
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(workerStepId); // worker 不被 chief 在跑挡住
  });

  test('失败方式 4：闸开时 FIFO 保序零漂移（chief 更早 → chief 先；worker 更早 → worker 先）', async () => {
    const w = await setupWorld();
    setCap(w, 2);
    // 方向一：chief 更早入队 → chief 先领（闸开时现行交错保序）。
    const olderChief = insertPendingChiefStep(w.s, { createdAt: 1_000 });
    const worker = insertPendingBuildStep(w.s, w);
    const first = await claimAs(w);
    expect(first?.step.id).toBe(olderChief);
    // 闸仍开（0 个 worker 在跑 < 2）→ 下一次领 worker。
    expect((await claimAs(w))?.step.id).toBe(worker);
    // 方向二：worker 更早 → worker 先领（同一 world 逆序再排一対）。
    const worker2 = insertPendingBuildStep(w.s, w);
    const worker2At = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, worker2))
      .get()!.createdAt;
    const newerChief = insertPendingChiefStep(w.s, { createdAt: worker2At + 1 });
    expect((await claimAs(w))?.step.id).toBe(worker2);
    // 收尾一格后：newerChief（晚于 worker2）是唯一候选 → 照领（闸开时无饥饿）。
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, worker)).run();
    expect((await claimAs(w))?.step.id).toBe(newerChief);
  });
});

describe('#1148 读面口径（runningSteps 只数非 chief 在跑）', () => {
  test('失败方式 3：me / 机器列表 runningSteps 剔除 chief', async () => {
    const w = await setupWorld();
    setCap(w, 3);
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000, kind: 'chief' });
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 4000 });
    const me = await w.s.app.request('/api/machine/me', {
      headers: { authorization: `Bearer ${w.tokenA}` },
    });
    const meBody = (await me.json()) as { maxConcurrent: number; runningSteps: number };
    expect(meBody.runningSteps).toBe(1); // 2 claimed 中只数 worker
    const list = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/machines`);
    const rows = (await list.json()) as { id: string; runningSteps?: number }[];
    expect(rows.find((r) => r.id === w.machineAId)?.runningSteps).toBe(1);
  });

  test('失败方式 3b：waitingFor.running 只数非 chief（排队投影）', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    // 归属本机的 pending 步在排队；本机在跑 1 chief（不占槽）。
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
      running: 0,
      capacity: 1,
    });
  });

  test('失败方式 3c：chief 线程 turnQueue 领走后退场（现行行为零漂移）', async () => {
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

describe('#1148 claim body maxWorkers（env 兜底的 server 消费面）', () => {
  test('失败方式 5：DB 3 / body 1、1 worker 在跑 → worker 不发；chief 照发', async () => {
    const w = await setupWorld();
    setCap(w, 3); // DB 行给 3
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 }); // 1 worker
    const workerStepId = insertPendingBuildStep(w.s, w);
    // body 自报 1 → 闸取 min(3, 1)：running 1 ≥ 1 → worker 不发。
    expect(await claimAs(w, { maxWorkers: 1 })).toBeNull();
    expect(
      w.s.db.select().from(stepTable).where(eq(stepTable.id, workerStepId)).get()!.status,
    ).toBe('pending');
    // chief 不受 body 闸约束（#1148 语义）。
    const chiefStepId = insertPendingChiefStep(w.s, { createdAt: Date.now() - 4000 });
    const claimed = await claimAs(w, { maxWorkers: 1 });
    expect(claimed?.step.id).toBe(chiefStepId);
  });

  test('失败方式 5b：body 缺席（老 daemon）= 只按 DB 行', async () => {
    const w = await setupWorld();
    setCap(w, 2);
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 }); // 1 worker
    const stepId = insertPendingBuildStep(w.s, w);
    const claimed = await claimAs(w); // 无 body
    expect(claimed?.step.id).toBe(stepId); // DB 闸开（1 < 2）→ 照发
  });

  test('失败方式 6：maxWorkers 0 → 400', async () => {
    const w = await setupWorld();
    const res = await w.s.app.request('/api/machine/tasks/claim', {
      method: 'POST',
      headers: { authorization: `Bearer ${w.tokenA}`, 'content-type': 'application/json' },
      body: JSON.stringify({ maxWorkers: 0 }),
    });
    expect(res.status).toBe(400);
  });
});
