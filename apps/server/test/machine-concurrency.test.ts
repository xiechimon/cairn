// #1108 机器并发上限 + 排队可见（server 面）：claim 容量闸、空位释放 wake、
// 排队投影（位次 + 等待对象）、写面校验。失败方式（先于实现固化）：
// 1. 满载不领：本机 claimed 步数 ≥ maxConcurrent → claim 空手、步留
//    pending（容量排队是合法态——不进失败漏斗，与钉选机离线扫尾正交）。
// 2. 空位即领：一步收尾（done）→ 下一步可领；finishStep 发 team wake
//    （满载机器挂起的 claim 长轮询被即时唤醒，不等满 hold）。
// 3. 上调即时生效 / 下调不抢占：PATCH maxConcurrent 后新领随新值；在飞步
//    照常收尾（闸只挡新认领）。
// 4. 投影口径：钉选步位次只数「该机可见集」（钉同机或未钉）；未钉步数全队
//    pending；waitingFor = 钉选机器 + running/capacity 快照；步被领走 →
//    投影退场（queue/turnQueue 消失）。
// 5. PATCH 校验：0 / 17 → 400；合法值落库并在机器记录带 runningSteps。
// 6. 旧形态零漂移：缺 maxConcurrent 字段的机器记录（老 server 响应形）→
//    wire 解析通过（optional 契约）。

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

/** seq 单调计数（todo.seqNum 团队内唯一——随机数有撞号面）+ createdAt 单调
 *  偏移（排队位次按 createdAt 序——同刻插入是随机序）。 */
let seqCounter = 9_000;

/** 建 todo + build + pending 首步（build kind 步；直插最小行集——claim 路径
 *  只消费 step/build/todo/agent 四行；assignment 指 AGENT_ID，无主步会被
 *  claim 静默跳过 = #1104 面）。 */
function insertPendingBuildStep(
  s: TestServer,
  world: World,
  opts: { agentId?: string } = {},
): { todoId: string; buildId: string; stepId: string } {
  const suffix = Math.random().toString(36).slice(2, 8);
  seqCounter += 1;
  const now = seqCounter; // 单调时标：调用序 = 队列序
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

describe('#1108 claim 容量闸（满载不领 / 空位即领 / 调整即时生效）', () => {
  test('失败方式 1：满载 → claim 空手、步留 pending（不进失败漏斗）', async () => {
    const w = await setupWorld();
    setCap(w, 2);
    // 占满两个位（直插 claimed 步——claim 闸只数本机 claimed 计数）。
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 4000 });
    const { stepId } = insertPendingBuildStep(w.s, w);
    const claimed = await claimAs(w);
    expect(claimed).toBeNull(); // 满载不发步
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status).toBe(
      'pending',
    );
  });

  test('失败方式 2：空位即领（在跑步收尾 → 容量闸开）', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    const running = insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 });
    const { stepId } = insertPendingBuildStep(w.s, w);
    expect(await claimAs(w)).toBeNull(); // cap=1 满载
    // 释放空位：在跑步收尾 → 容量闸开。
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, running)).run();
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(stepId);
  });

  test('失败方式 3：下调不抢占——在飞步照常、新步不领；上调即时生效', async () => {
    const w = await setupWorld();
    setCap(w, 3);
    const running = [
      insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 }),
      insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 4000 }),
    ];
    insertPendingBuildStep(w.s, w);
    // 下调到 2 = 在飞数 → 新步不领（不抢占在飞）。
    setCap(w, 2);
    expect(await claimAs(w)).toBeNull();
    // 在飞收尾一个 → 空位开。
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, running[0]!)).run();
    expect((await claimAs(w))?.step.id).toBeTruthy();
    // 上调：cap 3 → 剩余 1 在飞 + 新 pending → 可领。
    setCap(w, 3);
    const { stepId: step3 } = insertPendingBuildStep(w.s, w);
    expect((await claimAs(w))?.step.id).toBe(step3);
  });
});

describe('#1108 排队投影（位次 + 等待对象 + 读面挂载）', () => {
  test('失败方式 4（#1259 归属机版）：归属机步位次只数同归属机集；waitingFor 快照', async () => {
    const w = await setupWorld();
    setCap(w, 2);
    // 机器 A 满载（2 claimed）。
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 9000 });
    insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 8000 });
    // 第二台机器 B + 绑 B 的 agent。
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
    // 队列：中 pending（归 A）、晚 pending（归 B）、目标（归 A，最晚）。
    insertPendingBuildStep(w.s, w);
    const lateB = insertPendingBuildStep(w.s, w, { agentId: 'agent-cap-b' });
    const target = insertPendingBuildStep(w.s, w);
    const projector = stepQueueProjector(w.s.db, w.s.team.id);
    // 归 A 目标：可见集 = [midA, target]——归 B 的步不可见不计；位次 = 2。
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
    // 归 B 步：B 机可见集只它自己 → 位次 1；waitingFor = B 快照。
    const bInfo = projector.project({
      id: lateB.stepId,
      createdAt: Date.now(),
      homeMachineId: machineBId,
    });
    expect(bInfo?.position).toBe(1);
    expect(bInfo?.waitingFor).toMatchObject({ machineId: machineBId, running: 0, capacity: 3 });
  });

  test('失败方式 4b：steps 查询挂 queue；步被领走 → 投影退场', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    const running = insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 }); // 满载
    const { buildId, stepId } = insertPendingBuildStep(w.s, w);
    const rows = listSteps(machineDepsOf(w), buildId);
    const row = rows.find((r) => r.id === stepId);
    expect(row?.status).toBe('pending');
    expect(row?.queue).toMatchObject({ position: 1 });
    // 收尾占位步 → 领走目标 → queue 退场（claimed 行无投影）。
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, running)).run();
    await claimAs(w);
    const after = listSteps(machineDepsOf(w), buildId).find((r) => r.id === stepId);
    expect(after?.status).toBe('claimed');
    expect(after?.queue).toBeUndefined();
  });

  test('失败方式 4c：chief threads 挂 turnQueue；被领走后退场', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    const running = insertClaimedStep(w.s, w.machineAId, { createdAt: Date.now() - 5000 }); // 满载
    const now = Date.now();
    // chief 线程 + pending 回合步（直插——sendChiefMessage 面归 chief.test）。
    const threadId = `chief-cap-${Math.random().toString(36).slice(2, 8)}`;
    w.s.db
      .insert(chiefTable)
      .values({
        id: `chief-${w.s.user.id}-${w.s.team.id}`,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        agentId: AGENT_ID,
        charter: '',
        // #1260：chief 步的归属 = 绑定 Agent 的归属机（AGENT_ID 出生绑 A；
        // 投影的 waitingFor 快照源）。
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
    // 领走（腾出占位步后 claim）→ turnQueue 退场。
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

describe('#1108 写面与 wire 契约（PATCH 校验 / 记录投影 / wake）', () => {
  test('失败方式 5：PATCH maxConcurrent 0 / 17 → 400；合法值落库 + runningSteps', async () => {
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
    // 团队机器列表同投影。
    const list = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/machines`);
    const rows = (await list.json()) as {
      id: string;
      maxConcurrent: number;
      runningSteps: number;
    }[];
    expect(rows.find((r) => r.id === w.machineAId)?.maxConcurrent).toBe(5);
  });

  test('失败方式 6：老 server 形（无 maxConcurrent/runningSteps 字段）→ wire 解析通过', () => {
    // optional 加法契约：老响应缺字段可解析（消费面回退，混版本零崩）。
    const parsed = machineRecordSchema.parse({
      id: 'm-old',
      name: 'old',
      teamId: 't-old',
      online: false,
      latestCliVersion: null,
      kind: 'remote',
      enabledRuntimes: [],
      shellEnabled: false,
    });
    expect(parsed.maxConcurrent).toBeUndefined();
    expect(parsed.runningSteps).toBeUndefined();
  });

  test('失败方式 2b：finishStep 终态发 team wake（空位即时交接）', async () => {
    const w = await setupWorld();
    setCap(w, 1);
    const { stepId } = insertPendingBuildStep(w.s, w);
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(stepId);
    // 领走后机器满载——挂起的 claim 等 wake/hold；收尾步应发 wake。
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
