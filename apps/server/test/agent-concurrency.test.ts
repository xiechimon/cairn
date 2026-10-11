// #1138 agent 级并发闸（server 面）：claim 候选循环按 agent 计数 gate。
// 失败方式（先于实现固化）：
// 1. 上限即闸：agent.maxConcurrentTasks = 1 且该 Agent 已有 1 个 claimed
//    worker 步 → 第二个 pending 步 claim 空手、留 pending（不进失败漏斗
//    ——公平排队是合法态，与机器闸同语义）。
// 2. 分池不队头阻塞：Agent A 达上限时同批 Agent B 的候选照领——闸粒度 =
//    候选级（单候选 continue），不是整批收口。
// 3. 零值回归：不设上限（null = 缺省/存量行）的 Agent 在跑多步 → 行为
//    完全不变（照领新步）。
// 4. 空位即领：达上限后该 Agent 的在跑步收尾（done）→ 下一步可领。
// 5. 跨机归账 + 与机器闸的 min 合成：机器有空位（machine 闸开）但该
//    Agent 在**其它机器**上的 claimed 步已计入 → 仍不领（agent 池跨机器；
//    两层各自 gate 的自然结果，无集中取 min 的判定）。
// 6. chief 步不占 agent 槽（#1148 对称）：该 Agent 的 chief 步在跑 →
//    worker 步照领（agent 计数只数非 chief worker 步）。
// 7. review 步归账：claimed review 步的 agentId 在 prompt meta 头里 →
//    计入该 Agent 的在跑数。
// 8. 写面与投影：PATCH maxConcurrentTasks 落库即时生效；显式 null 清回
//    不限；0 / 51 → 400；记录带字段；老 server 形（缺字段）wire 可解析。

import { agentRecordSchema } from '@pacman/shared';
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
import { claimStep } from '../src/services/machines.js';
import { bootServer, issueApiKey, postProject, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const AGENT_A = 'agent-agcap-a';
const AGENT_B = 'agent-agcap-b';

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
    .where(eq(machineTable.name, 'agcap-mbp'))
    .get()!.id;
  for (const [id, name] of [
    [AGENT_A, 'agcap-agent-a'],
    [AGENT_B, 'agcap-agent-b'],
  ] as const) {
    s.db
      .insert(agentTable)
      .values({
        id,
        teamId: s.team.id,
        displayName: name,
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
        // #1138：null = 不限（缺省语义——本字段即本票新增列）。
        maxConcurrentTasks: null,
      })
      .run();
  }
  const projectId = await postProject(s.app, 'agcap-proj');
  return { s, tokenA, machineAId, projectId };
}

async function fetchEnroll(s: TestServer, key: string): Promise<{ token: string }> {
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'agcap-mbp', cliVersion: '0.1.0' }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { token: string };
}

/** seq 单调计数（todo.seqNum 团队内唯一——随机数有撞号面）+ createdAt 单调
 *  偏移（队列按 createdAt 序——同刻插入是随机序）。 */
let seqCounter = 9_700;

/** 建 todo + build + pending 首步（build kind 步；assignment 指 opts.agent）。 */
function insertPendingBuildStep(
  s: TestServer,
  world: World,
  opts: { agentId: string },
): { todoId: string; buildId: string; stepId: string } {
  const suffix = Math.random().toString(36).slice(2, 8);
  seqCounter += 1;
  const now = seqCounter; // 单调时标：调用序 = 队列序
  s.db
    .insert(todoTable)
    .values({
      id: `todo-agcap-${suffix}`,
      teamId: s.team.id,
      projectId: world.projectId,
      seqNum: seqCounter,
      title: `agent 闸任务 ${suffix}`,
      spec: '探针',
      phase: 'queued',
      phaseAt: now,
      assignment: { plan: null, build: { agentId: opts.agentId } },
      machineId: null,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: `build-agcap-${suffix}`,
      todoId: `todo-agcap-${suffix}`,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: now,
      pinnedMachineId: null,
    })
    .run();
  const stepId = `step-agcap-${suffix}`;
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: `build-agcap-${suffix}`,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt: now + 1,
    })
    .run();
  return { todoId: `todo-agcap-${suffix}`, buildId: `build-agcap-${suffix}`, stepId };
}

/** 占位 claimed worker 步（完整 todo/build/step 三行——agent 计数按
 *  step⋈build⋈todo 归账，孤儿步不计）：opts.machineId = 持有机器（可任意，
 *  归账与机器无关）；opts.kind/prompt 支 review meta 归账形态。 */
function insertClaimedAgentStep(
  s: TestServer,
  world: World,
  opts: {
    agentId: string;
    machineId: string;
    kind?: 'build' | 'review';
    prompt?: string | null;
  },
): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  seqCounter += 1;
  const now = seqCounter;
  s.db
    .insert(todoTable)
    .values({
      id: `todo-agrun-${suffix}`,
      teamId: s.team.id,
      projectId: world.projectId,
      seqNum: seqCounter,
      title: `agent 闸在跑 ${suffix}`,
      spec: '探针',
      phase: 'building',
      phaseAt: now,
      assignment: { plan: null, build: { agentId: opts.agentId } },
      machineId: null,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: `build-agrun-${suffix}`,
      todoId: `todo-agrun-${suffix}`,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: now,
      pinnedMachineId: null,
    })
    .run();
  const stepId = `step-agrun-${suffix}`;
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: `build-agrun-${suffix}`,
      kind: opts.kind ?? 'build',
      machineId: opts.machineId,
      status: 'claimed',
      prompt: opts.prompt ?? null,
      freshSession: false,
      createdAt: now + 1,
      claimedAt: now + 1,
      lastHeartbeatAt: now + 1,
    })
    .run();
  return stepId;
}

/** 占位 claimed chief 步（直插 chief + chiefThread + step，绑定 AGENT_A——
 *  与 machine-concurrency-chief.test.ts 4c 同形）。 */
function insertClaimedChiefStep(s: TestServer, world: World, agentId: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  const now = Date.now();
  const chiefId = `chief-${suffix}`;
  const threadId = `chief-thread-agcap-${suffix}`;
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: s.user.id,
      teamId: s.team.id,
      agentId,
      charter: '',
      createdAt: now,
    })
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: threadId,
      chiefId,
      userId: s.user.id,
      teamId: s.team.id,
      title: 'agcap chief 线程',
      createdAt: now,
      updatedAt: now,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: now,
      pendingSessionResumeAt: null,
      pinnedMachineId: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: { phase: 'chief' },
    })
    .run();
  const stepId = `step-chief-agcap-${suffix}`;
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: threadId,
      kind: 'chief',
      machineId: world.machineAId,
      status: 'claimed',
      prompt: '帮我看看',
      createdAt: now + 1,
      claimedAt: now + 1,
      lastHeartbeatAt: now + 1,
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

function claimAs(w: World, machineId = w.machineAId) {
  return claimStep(machineDepsOf(w), machineId, w.s.team.id, 10, 'http://localhost');
}

function setAgentCap(w: World, agentId: string, cap: number | null): void {
  w.s.db
    .update(agentTable)
    .set({ maxConcurrentTasks: cap })
    .where(eq(agentTable.id, agentId))
    .run();
}

describe('#1138 agent 并发闸（上限即闸 / 分池 / 零值回归 / 空位即领）', () => {
  test('失败方式 1：上限 1 → 该 agent 第二步不进 claim，留 pending', async () => {
    const w = await setupWorld();
    setAgentCap(w, AGENT_A, 1);
    insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: w.machineAId });
    const { stepId } = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    const claimed = await claimAs(w);
    expect(claimed).toBeNull(); // agent 满载不发步（机器闸开着——机器才 1/3）
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status).toBe(
      'pending',
    );
  });

  test('失败方式 2：分池不队头阻塞——A 满载时同批 B 的候选照领', async () => {
    const w = await setupWorld();
    setAgentCap(w, AGENT_A, 1);
    insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: w.machineAId });
    // A 的候选更早（先插）：闸挡它，不挡后面的 B 候选（候选级 continue）。
    insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    const candB = insertPendingBuildStep(w.s, w, { agentId: AGENT_B });
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(candB.stepId);
  });

  test('失败方式 3：零值回归——不设上限的 agent 多步在跑照领新步', async () => {
    const w = await setupWorld();
    // 不设 maxConcurrentTasks（null = 缺省）：两步在跑（机器 cap 3 内）。
    insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: w.machineAId });
    insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: w.machineAId });
    const { stepId } = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(stepId); // 行为完全不变（回归红线）
  });

  test('失败方式 4：空位即领——在跑步收尾后 agent 闸开', async () => {
    const w = await setupWorld();
    setAgentCap(w, AGENT_A, 1);
    const running = insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: w.machineAId });
    const { stepId } = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    expect(await claimAs(w)).toBeNull(); // 满载
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, running)).run();
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(stepId);
  });
});

describe('#1138 闸间交互（跨机归账 / min 合成 / chief 不占槽 / review 归账）', () => {
  test('失败方式 5：机器有空位但 agent 在别机的步已计入 → 仍不领', async () => {
    const w = await setupWorld();
    setAgentCap(w, AGENT_A, 1);
    // 该 agent 的在跑步挂在另一台机（行不存在也无妨——归账与机器无关）。
    insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: 'machine-agcap-other' });
    const { stepId } = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    // 本机 machine 闸开着（0/3 在跑）——仅 agent 闸挡。
    const claimed = await claimAs(w);
    expect(claimed).toBeNull();
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status).toBe(
      'pending',
    );
  });

  test('失败方式 6：chief 步不占 agent 槽（#1148 对称）——chief 在跑照领 worker', async () => {
    const w = await setupWorld();
    setAgentCap(w, AGENT_A, 1);
    insertClaimedChiefStep(w.s, w, AGENT_A); // 该 agent 的 chief 步 claimed
    const { stepId } = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(stepId);
  });

  test('失败方式 7：review 步按 prompt meta 归账——计入该 agent 在跑数', async () => {
    const w = await setupWorld();
    setAgentCap(w, AGENT_A, 1);
    // claimed review 步：agentId 在 meta 头（assignment 槽指向 B 也不算 B——
    // review 归账单源 = meta，与 agentForStep 同一原语）。
    insertClaimedAgentStep(w.s, w, {
      agentId: AGENT_B, // todo 的 build 槽指 B：review 分支不消费它
      machineId: 'machine-agcap-other',
      kind: 'review',
      prompt: `{"kind":"review","agentId":"${AGENT_A}"}\n审一下`,
    });
    const { stepId } = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    expect(await claimAs(w)).toBeNull();
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status).toBe(
      'pending',
    );
  });
});

describe('#1138 写面与 wire 契约（PATCH 校验 / 记录投影）', () => {
  test('失败方式 8：PATCH 落库即时生效 / null 清回不限 / 0 与 51 → 400 / 老形可解析', async () => {
    const w = await setupWorld();
    for (const bad of [0, 51]) {
      const res = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${AGENT_A}`, {
        maxConcurrentTasks: bad,
      });
      expect(res.status).toBe(400);
    }
    // 落库 + 记录投影。
    const res = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${AGENT_A}`, {
      maxConcurrentTasks: 1,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { maxConcurrentTasks: number | null };
    expect(body.maxConcurrentTasks).toBe(1);
    expect(
      w.s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_A)).get()!.maxConcurrentTasks,
    ).toBe(1);
    // 即时生效：一步在跑 → 第二步不领。
    insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: w.machineAId });
    const gated = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    expect(await claimAs(w)).toBeNull();
    // 显式 null = 清回不限（undefined 才是不动）。
    const cleared = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${AGENT_A}`, {
      maxConcurrentTasks: null,
    });
    expect(cleared.status).toBe(200);
    const clearedBody = (await cleared.json()) as { maxConcurrentTasks: number | null };
    expect(clearedBody.maxConcurrentTasks).toBeNull();
    // 闸已开：先前被闸挡的 pending 步可领（FIFO——最早候选先走）。
    expect((await claimAs(w))?.step.id).toBe(gated.stepId);
    // 老形：字段缺席 = optional 契约（混版本零崩）。
    const parsed = agentRecordSchema.parse({
      id: 'a-old',
      displayName: 'old',
      description: null,
      status: 'active',
      avatarUrl: null,
      provider: null,
      modelId: null,
      thinkingLevel: null,
      tools: [],
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: [],
    });
    expect(parsed.maxConcurrentTasks).toBeUndefined();
  });
});
