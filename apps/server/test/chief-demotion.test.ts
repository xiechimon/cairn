// #1260 总管降级为普通 agent（对齐 Multica leader 模型）：chief 步的去处 =
// 绑定 Agent 的归属机（chief.machineId 主力机槽退役）；chief 步占机器并发槽
// 且受绑定 Agent 并发闸；模型/思考强度 = 绑定 Agent 自身配置（chief 行的
// model/compactionModel/thinkingLevel 覆盖槽退役）。
// 失败方式（先于实现固化）：
// 1. 路由换源：绑定 Agent 的归属机 M 在线 → 唯 M 可领 chief 步；他机 claim
//    空手、步留 pending（chief.machineId 已不存在，无「主力机」第二答案）。
// 2. 同闸：归属机 runtime 闸关（agent 是 claude-code 档、机器只开 pi）→
//    归属机自己也空手（与 worker 步同一 runtimeGatePasses）。
// 3. 占机器槽：maxConcurrent=1 且一条 worker 步在跑 → chief 步空手（满载
//    不再放行 chief）；反向——chief 步在跑占满 → worker 步空手。
// 4. 占 Agent 槽：绑定 Agent maxConcurrentTasks=1 且其 chief 步在跑 → 该
//    Agent 的 worker 步与另一线程的 chief 步均空手（agent 计数含 chief 步
//    ——经 chiefThread→chief.agentId 归账）。
// 5. 无继承：claim 载荷的 provider/modelId/thinkingLevel 恒 = 绑定 Agent
//    行值（chief 行无覆盖槽可改它）。
// 6. 退役槽 wire 面：PATCH /chief 只带 machineId/model/compactionModel →
//    400；GET /chief 的 chief 记录无这三个键；orchestration.homeMachineId =
//    绑定 Agent 的归属机。
// 7. 未绑定 Agent 的 chief 步：任何机器不可领，sweep 宽限后 failed，文案
//    指「总管未绑定 Agent」（无期静默 pending 是 bug）。
// 8. 绑定 Agent 未设归属机：同上，文案指名 Agent 未设归属机。
// 9. 归属机离线超宽限：failed + 点名归属机（homeOfflineReason 同 worker 族）。

import { chiefTurnErrorContentSchema } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  chiefMessage,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { failAbandonedChiefSteps } from '../src/services/chief.js';
import { PIN_OFFLINE_GRACE_MS } from '../src/services/dispatch-timeouts.js';
import { claimStep, type MachineDeps } from '../src/services/machines.js';
import { bootServer, insertMachine, postProject, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const AGENT_ID = 'agent-chief-demote';

interface World {
  s: TestServer;
  machineAId: string;
  machineBId: string;
  projectId: string;
  chiefId: string;
  threadId: string;
  stepId: string;
}

function machineDepsOf(s: TestServer): MachineDeps {
  return {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
}

/** 建世界：两台在线机器 + Agent（默认绑归属机 A）+ chief 行 + 线程 +
 *  pending chief 步。opts.agentMachineId null = Agent 不设归属机；
 *  opts.bindAgent false = chief 不绑定 Agent。 */
async function setupWorld(
  opts: { agentMachineId?: string | null; bindAgent?: boolean; provider?: string } = {},
): Promise<World> {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const machineAId = insertMachine(s, { name: 'demote-a' });
  const machineBId = insertMachine(s, { name: 'demote-b' });
  const projectId = await postProject(s.app, 'demote-proj');
  const home = opts.agentMachineId === undefined ? machineAId : opts.agentMachineId;
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'demote-agent',
      provider: opts.provider ?? 'stub-gw',
      modelId: 'stub-model',
      thinkingLevel: 'high',
      machineId: home,
    })
    .run();
  const chiefId = `chief-${s.svc.user.id}-${s.team.id}`;
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      agentId: opts.bindAgent === false ? null : AGENT_ID,
      charter: '',
      createdAt: 1,
    })
    .run();
  const threadId = 'chief-demote-thread';
  s.db
    .insert(chiefThreadTable)
    .values({
      id: threadId,
      chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: '降级探针线程',
      createdAt: 2,
      updatedAt: 2,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: 2,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: { phase: 'chief' },
    })
    .run();
  const stepId = 'step-chief-demote-1';
  s.db
    .insert(stepTable)
    .values({ id: stepId, buildId: threadId, kind: 'chief', status: 'pending', createdAt: 3 })
    .run();
  return { s, machineAId, machineBId, projectId, chiefId, threadId, stepId };
}

function claimOn(w: World, machineId: string) {
  return claimStep(machineDepsOf(w.s), machineId, w.s.team.id, 10, 'http://localhost');
}

function stepRowOf(w: World, id = w.stepId) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, id)).get()!;
}

/** 该线程回合的失败行文案（#631 链：chief-err-<stepId>）。 */
function turnErrorMessage(w: World): string | null {
  const row = w.s.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.id, `chief-err-${w.stepId}`))
    .get();
  if (!row) return null;
  const parsed = chiefTurnErrorContentSchema.safeParse(JSON.parse(row.content as string));
  return parsed.success ? parsed.data.message : null;
}

/** 直插一条 claimed 步占机器 A 的槽（kind = chief 时挂在 world 线程上，
 *  归账绑定 Agent；kind = build 时挂完整 todo/build 链）。 */
function insertClaimedOn(w: World, kind: 'build' | 'chief'): void {
  if (kind === 'chief') {
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-chief-occupied',
        buildId: w.threadId,
        kind: 'chief',
        machineId: w.machineAId,
        status: 'claimed',
        createdAt: 4,
        claimedAt: 4,
        lastHeartbeatAt: 4,
      })
      .run();
    return;
  }
  w.s.db
    .insert(todoTable)
    .values({
      id: 'todo-demote-1',
      teamId: w.s.team.id,
      projectId: w.projectId,
      seqNum: 991,
      title: '占槽任务',
      spec: '',
      phase: 'building',
      phaseAt: 4,
      assignment: { plan: null, build: { agentId: AGENT_ID } },
    })
    .run();
  w.s.db
    .insert(buildTable)
    .values({
      id: 'build-demote-1',
      todoId: 'todo-demote-1',
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: 4,
    })
    .run();
  w.s.db
    .insert(stepTable)
    .values({
      id: 'step-build-occupied',
      buildId: 'build-demote-1',
      kind: 'build',
      machineId: w.machineAId,
      status: 'claimed',
      createdAt: 5,
      claimedAt: 5,
      lastHeartbeatAt: 5,
    })
    .run();
}

/** 直插一条该 Agent 的 pending worker 步（候选探针）。 */
function insertPendingWorkerStep(w: World): string {
  w.s.db
    .insert(todoTable)
    .values({
      id: 'todo-demote-2',
      teamId: w.s.team.id,
      projectId: w.projectId,
      seqNum: 992,
      title: '候选任务',
      spec: '',
      phase: 'queued',
      phaseAt: 6,
      assignment: { plan: null, build: { agentId: AGENT_ID } },
    })
    .run();
  w.s.db
    .insert(buildTable)
    .values({
      id: 'build-demote-2',
      todoId: 'todo-demote-2',
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: 6,
    })
    .run();
  w.s.db
    .insert(stepTable)
    .values({
      id: 'step-build-waiting',
      buildId: 'build-demote-2',
      kind: 'build',
      status: 'pending',
      createdAt: 7,
    })
    .run();
  return 'step-build-waiting';
}

describe('#1260 路由换源：chief 步去处 = 绑定 Agent 的归属机', () => {
  test('失败方式 1：他机 claim 空手、步留 pending；归属机领到', async () => {
    const w = await setupWorld();
    expect(await claimOn(w, w.machineBId)).toBeNull();
    expect(stepRowOf(w).status).toBe('pending');
    const home = await claimOn(w, w.machineAId);
    expect(home?.step.id).toBe(w.stepId);
    expect(home?.step.machineId).toBe(w.machineAId);
  });

  test('失败方式 2：归属机 runtime 闸关 → 归属机也空手（同 worker 闸）', async () => {
    const w = await setupWorld({ provider: 'claude-code' });
    w.s.db
      .update(machineTable)
      .set({ enabledRuntimes: ['pi'] })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    expect(await claimOn(w, w.machineAId)).toBeNull();
    expect(stepRowOf(w).status).toBe('pending');
  });

  test('失败方式 5：载荷模型/思考强度 = 绑定 Agent 自身配置（无覆盖槽）', async () => {
    const w = await setupWorld();
    const claimed = await claimOn(w, w.machineAId);
    expect(claimed?.agent?.provider).toBe('stub-gw');
    expect(claimed?.agent?.modelId).toBe('stub-model');
    expect(claimed?.agent?.thinkingLevel).toBe('high');
  });
});

describe('#1260 占槽：chief 步 = 机器槽与 Agent 槽的普通消费者', () => {
  test('失败方式 3a：worker 满载（cap 1）→ chief 步空手，步留 pending', async () => {
    const w = await setupWorld();
    w.s.db
      .update(machineTable)
      .set({ maxConcurrent: 1 })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    insertClaimedOn(w, 'build');
    expect(await claimOn(w, w.machineAId)).toBeNull();
    expect(stepRowOf(w).status).toBe('pending');
  });

  test('失败方式 3b：chief 步在跑占满（cap 1）→ worker 步空手', async () => {
    const w = await setupWorld();
    w.s.db
      .update(machineTable)
      .set({ maxConcurrent: 1 })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    insertClaimedOn(w, 'chief');
    const waiting = insertPendingWorkerStep(w);
    expect(await claimOn(w, w.machineAId)).toBeNull();
    expect(stepRowOf(w, waiting).status).toBe('pending');
    expect(stepRowOf(w).status).toBe('pending'); // 本线程 pending 回合同被挡
  });

  test('失败方式 4：Agent 槽（maxConcurrentTasks=1）——chief 步在跑 → 同 Agent worker/他线程 chief 均空手', async () => {
    const w = await setupWorld();
    w.s.db
      .update(agentTable)
      .set({ maxConcurrentTasks: 1 })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    insertClaimedOn(w, 'chief'); // 该 Agent 的 chief 步在跑（占其唯一槽）
    const waiting = insertPendingWorkerStep(w);
    w.s.db
      .insert(chiefThreadTable)
      .values({
        id: 'chief-demote-thread-2',
        chiefId: w.chiefId,
        userId: w.s.svc.user.id,
        teamId: w.s.team.id,
        title: '第二线程',
        createdAt: 8,
        updatedAt: 8,
        sessionRuntime: 'pi',
        sessionId: '',
        sessionOpenedAt: 8,
        pendingSessionResumeAt: null,
        toolDefHashes: {},
        toolResultHashes: {},
        activeRun: null,
      })
      .run();
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-chief-demote-2',
        buildId: 'chief-demote-thread-2',
        kind: 'chief',
        status: 'pending',
        createdAt: 9,
      })
      .run();
    expect(await claimOn(w, w.machineAId)).toBeNull();
    expect(stepRowOf(w).status).toBe('pending');
    expect(stepRowOf(w, 'step-chief-demote-2').status).toBe('pending');
    expect(stepRowOf(w, waiting).status).toBe('pending');
  });
});

describe('#1260 退役槽 wire 面', () => {
  test('失败方式 6：PATCH 只带 machineId/model/compactionModel → 400；GET chief 记录无三键；orchestration.homeMachineId = 绑定 Agent 归属机', async () => {
    const w = await setupWorld();
    for (const body of [
      { machineId: w.machineBId },
      { model: { provider: 'pi', modelId: 'x' } },
      { compactionModel: { provider: 'pi', modelId: 'x' } },
    ]) {
      const res = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/chief`, body);
      expect(res.status).toBe(400);
    }
    const res = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/chief`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const chiefRec = body.chief as Record<string, unknown>;
    expect('machineId' in chiefRec).toBe(false);
    expect('model' in chiefRec).toBe(false);
    expect('compactionModel' in chiefRec).toBe(false);
    const orch = body.orchestration as { homeMachineId: string | null };
    expect(orch.homeMachineId).toBe(w.machineAId);
  });

  test('PATCH agent 槽不再受理 thinkingLevel 覆盖（绑定/换绑照常 200）', async () => {
    const w = await setupWorld();
    const res = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/chief`, {
      agent: { agentId: AGENT_ID, thinkingLevel: 'low' },
    });
    // thinkingLevel 键被 schema 剥离，绑定本身成立；chief 行不再有思考强度
    // 位——载荷恒取 Agent 行值（失败方式 5 钉死）。
    expect(res.status).toBe(200);
  });
});

describe('#1260 sweep 失败漏斗（failAbandonedChiefSteps 归属机版）', () => {
  test('失败方式 7：未绑定 Agent → 宽限后 failed，文案指「总管未绑定 Agent」', async () => {
    const w = await setupWorld({ bindAgent: false });
    failAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + PIN_OFFLINE_GRACE_MS + 1);
    expect(stepRowOf(w).status).toBe('failed');
    expect(turnErrorMessage(w)).toContain('总管未绑定 Agent');
  });

  test('失败方式 8：绑定 Agent 未设归属机 → 宽限后 failed，文案指名 Agent', async () => {
    const w = await setupWorld({ agentMachineId: null });
    failAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + PIN_OFFLINE_GRACE_MS + 1);
    expect(stepRowOf(w).status).toBe('failed');
    const message = turnErrorMessage(w);
    expect(message).toContain('demote-agent');
    expect(message).toContain('未设归属机');
  });

  test('失败方式 9：归属机离线超宽限 → failed + 点名归属机', async () => {
    const w = await setupWorld();
    w.s.db
      .update(machineTable)
      .set({ online: false })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    failAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + PIN_OFFLINE_GRACE_MS + 1);
    expect(stepRowOf(w).status).toBe('failed');
    const message = turnErrorMessage(w);
    expect(message).toContain('demote-a');
    expect(message).toContain('离线');
  });

  test('归属机在线且闸开 → 不误杀（合法排队）', async () => {
    const w = await setupWorld();
    failAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 60_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorMessage(w)).toBeNull();
  });
});
