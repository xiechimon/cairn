// #1251 可见 pending reason（排队投影 blocked 位 + 板面挂起态）：
// pending 成因区分「等机器上线」（等待有用）与「缺能力」（装 X 即解锁，给修法）
// ——Multica dispatch/reason.go 族语义对位（runtime_offline vs runtime_unusable
// 的分野：等待有没有用），落 pacman 两个读面：
// - 步级 = stepQueueProjector 的 queue.blocked（step-queue.ts，#1108 排队投影
//   扩展位——transcript「排队中」行与 chief turnQueue 两面同源）；
// - 板面 = todo waitingOn 派生（#1257 律：pending 不再失败收尾，挂起等机器；
//   todos.ts waitingOnOf 钉选机在线但能力闸挡 → 同 {on:'machine'} 挂起态，
//   chip 粗粒度，缺项点名 + 修法文案归 queue.blocked 面）。
// 失败方式（先于实现固化）：
// 1. 未钉 + 在线机全缺能力 → blocked capability-missing，missing 点名可读形。
// 2. 未钉 + 团队零在线机器 → blocked machine-offline（missing 空集）——
//    无 requiredCapabilities 的 agent 同样给（离线等待与能力无关，是事实）。
// 3. 有能力齐的在线机 → blocked 缺席（正常排队，零回归）。
// 4. fail-open 显示面同律：在线机未上报快照 → blocked 缺席（未知不编造缺项）。
// 5. 钉选离线机 → machine-offline；钉选在线缺能力机 → capability-missing。
// 6. runtime 闸挡（机器在线但没开 runtime）不冒充能力成因——既有已知缝
//    保持既有呈现（blocked 缺席），能力闸不越权。
// 7. chief 回合同律（turnQueue 投影同形）。
// 8. #1257 挂起律：钉选在线能力挡 → sweep 不做失败收尾（pending 面无失败），
//    步挂起等机器，板面可见态 = todo waitingOn {on:'machine'} 派生。
// 9. 能力补齐后 waitingOn 挂起态即消失（可领即活）；chief pending 回合
//    同样不被 sweep 触碰。

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  chiefMessage as chiefMessageTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { BUILD_ABANDONED_STEP_MS, sweepAbandonedBuildSteps } from '../src/services/builds.js';
import { sweepAbandonedChiefSteps } from '../src/services/chief.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import { toTodoRecord } from '../src/services/todos.js';
import { bootServer, postProject, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

let seqCounter = 9_900;

interface ReasonWorld {
  s: TestServer;
  teamId: string;
  projectId: string;
  base: number;
}

function makeWorld(): ReasonWorld {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const base = Date.now();
  // projectId 由 postProject 提供需要 async——直插 project 行（sweep 测试同律）。
  const projectId = 'proj-capreason';
  s.db.insert(projectTable).values({ id: projectId, name: 'capreason', teamId: s.team.id }).run();
  return { s, teamId: s.team.id, projectId, base };
}

function insertMachine(
  w: ReasonWorld,
  opts: {
    id: string;
    online?: boolean;
    runtimes?: string[];
    capabilities?: { mcpServers: string[]; skills: string[] } | null;
    claudeModels?: string[];
  },
): void {
  w.s.db
    .insert(machineTable)
    .values({
      id: opts.id,
      teamId: w.teamId,
      name: opts.id,
      online: opts.online ?? true,
      enabledRuntimes: opts.runtimes ?? ['pi'],
      capabilities: opts.capabilities === undefined ? null : opts.capabilities,
      ...(opts.claudeModels !== undefined
        ? {
            claudeCodeReport: {
              installed: true,
              hostname: opts.id,
              models: opts.claudeModels.map((id) => ({ id, name: id })),
            },
          }
        : {}),
      maxConcurrent: 3,
    })
    .run();
}

function insertAgent(
  w: ReasonWorld,
  opts: { id: string; requiredCapabilities?: { mcpServers?: string[]; models?: string[] } | null },
): void {
  w.s.db
    .insert(agentTable)
    .values({
      id: opts.id,
      teamId: w.teamId,
      displayName: opts.id,
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
      maxConcurrentTasks: null,
      requiredCapabilities: opts.requiredCapabilities ?? null,
    })
    .run();
}

/** pending worker 步三行组（todo/build/step），返回投影目标。 */
function insertPendingWorkerStep(
  w: ReasonWorld,
  opts: { agentId: string; pinnedMachineId?: string | null; createdAgo?: number },
): {
  id: string;
  createdAt: number;
  pinnedMachineId: string | null;
  buildId: string;
  todoId: string;
} {
  const suffix = Math.random().toString(36).slice(2, 8);
  seqCounter += 1;
  const createdAt = w.base - (opts.createdAgo ?? 0);
  const todoId = `todo-cr-${suffix}`;
  const buildId = `build-cr-${suffix}`;
  const id = `step-cr-${suffix}`;
  const pinnedMachineId = opts.pinnedMachineId ?? null;
  w.s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: w.teamId,
      projectId: w.projectId,
      seqNum: seqCounter,
      title: `pending reason ${suffix}`,
      spec: '探针',
      phase: 'queued',
      phaseAt: createdAt,
      assignment: { plan: null, build: { agentId: opts.agentId } },
      machineId: null,
    })
    .run();
  w.s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt,
      pinnedMachineId,
    })
    .run();
  w.s.db
    .insert(stepTable)
    .values({
      id,
      buildId,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt,
    })
    .run();
  return { id, createdAt, pinnedMachineId, buildId, todoId };
}

/** pending chief 步三行组（chief/chiefThread/step），返回投影目标。 */
function insertPendingChiefStep(
  w: ReasonWorld,
  opts: { agentId: string; pinnedMachineId?: string | null; createdAgo?: number },
): { id: string; createdAt: number; pinnedMachineId: string | null; threadId: string } {
  const suffix = Math.random().toString(36).slice(2, 8);
  const createdAt = w.base - (opts.createdAgo ?? 0);
  const chiefId = `chief-cr-${suffix}`;
  const threadId = `chief-thread-cr-${suffix}`;
  const id = `step-chief-cr-${suffix}`;
  const pinnedMachineId = opts.pinnedMachineId ?? null;
  w.s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: w.s.user.id,
      teamId: w.teamId,
      agentId: opts.agentId,
      charter: '',
      createdAt,
    })
    .run();
  w.s.db
    .insert(chiefThreadTable)
    .values({
      id: threadId,
      chiefId,
      userId: w.s.user.id,
      teamId: w.teamId,
      title: 'pending reason chief',
      createdAt,
      updatedAt: createdAt,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: createdAt,
      pendingSessionResumeAt: null,
      pinnedMachineId,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: { phase: 'chief' },
    })
    .run();
  w.s.db
    .insert(stepTable)
    .values({
      id,
      buildId: threadId,
      kind: 'chief',
      machineId: null,
      status: 'pending',
      prompt: '帮我看看',
      createdAt,
    })
    .run();
  return { id, createdAt, pinnedMachineId, threadId };
}

function buildRowOf(w: ReasonWorld, buildId: string) {
  return w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
}

function stepRowOf(w: ReasonWorld, stepId: string) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
}

describe('#1251 排队投影 blocked 位（worker 步）', () => {
  test('失败方式 1：在线机全缺能力 → capability-missing + 可读缺项', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r1', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-r1a', capabilities: { mcpServers: ['ctx'], skills: [] } });
    insertMachine(w, { id: 'm-r1b', capabilities: { mcpServers: [], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-r1' });
    const info = stepQueueProjector(w.s.db, w.teamId).project(target);
    expect(info?.blocked).toEqual({
      kind: 'capability-missing',
      missing: ['MCP server "figma"'],
    });
    expect(info?.position).toBe(1); // 位次照算（blocked 不吞排队事实）
  });

  test('失败方式 2：团队零在线机器 → machine-offline（无能力要求的 agent 同样给）', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r2' });
    insertMachine(w, { id: 'm-r2', online: false, capabilities: { mcpServers: [], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-r2' });
    const info = stepQueueProjector(w.s.db, w.teamId).project(target);
    expect(info?.blocked).toEqual({ kind: 'machine-offline', missing: [] });
  });

  test('失败方式 3：有能力齐的在线机 → blocked 缺席（正常排队）', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r3', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-r3a', capabilities: { mcpServers: ['ctx'], skills: [] } });
    insertMachine(w, { id: 'm-r3b', capabilities: { mcpServers: ['figma'], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-r3' });
    expect(stepQueueProjector(w.s.db, w.teamId).project(target)?.blocked).toBeUndefined();
  });

  test('失败方式 4：在线机未上报快照 → blocked 缺席（fail-open 显示面同律）', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r4', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-r4', capabilities: null });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-r4' });
    expect(stepQueueProjector(w.s.db, w.teamId).project(target)?.blocked).toBeUndefined();
  });

  test('失败方式 5：钉选离线机 → machine-offline；钉选在线缺能力机 → capability-missing', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r5', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, {
      id: 'm-r5-off',
      online: false,
      capabilities: { mcpServers: [], skills: [] },
    });
    insertMachine(w, { id: 'm-r5-on', capabilities: { mcpServers: [], skills: [] } });
    const offlineTarget = insertPendingWorkerStep(w, {
      agentId: 'agent-r5',
      pinnedMachineId: 'm-r5-off',
    });
    const onlineTarget = insertPendingWorkerStep(w, {
      agentId: 'agent-r5',
      pinnedMachineId: 'm-r5-on',
    });
    const projector = stepQueueProjector(w.s.db, w.teamId);
    expect(projector.project(offlineTarget)?.blocked).toEqual({
      kind: 'machine-offline',
      missing: [],
    });
    expect(projector.project(onlineTarget)?.blocked).toEqual({
      kind: 'capability-missing',
      missing: ['MCP server "figma"'],
    });
  });

  test('失败方式 6：runtime 闸挡不冒充能力成因 → blocked 缺席（既有缝既有呈现）', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r6', requiredCapabilities: { mcpServers: ['figma'] } });
    // 在线但 pi 关（runtime 闸挡）——即使能力也缺，成因不归能力维。
    insertMachine(w, { id: 'm-r6', runtimes: [], capabilities: { mcpServers: [], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-r6' });
    expect(stepQueueProjector(w.s.db, w.teamId).project(target)?.blocked).toBeUndefined();
  });

  test('失败方式 1 补：models 维缺项同形点名', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r7', requiredCapabilities: { models: ['glm-5.3'] } });
    insertMachine(w, {
      id: 'm-r7',
      capabilities: { mcpServers: [], skills: [] },
      claudeModels: ['other-model'],
    });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-r7' });
    expect(stepQueueProjector(w.s.db, w.teamId).project(target)?.blocked).toEqual({
      kind: 'capability-missing',
      missing: ['model "glm-5.3"'],
    });
  });
});

describe('#1251 排队投影 blocked 位（chief 回合）', () => {
  test('失败方式 7：绑定 Agent 缺能力 → turnQueue 投影同形 blocked', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-c1', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-c1', capabilities: { mcpServers: [], skills: [] } });
    insertPendingChiefStep(w, { agentId: 'agent-c1' });
    const projector = stepQueueProjector(w.s.db, w.teamId);
    const target = projector.pendingChiefOf(w.s.db.select().from(chiefThreadTable).get()!.id);
    expect(target).not.toBeNull();
    const info = target === null ? null : projector.project(target);
    expect(info?.blocked).toEqual({
      kind: 'capability-missing',
      missing: ['MCP server "figma"'],
    });
  });
});

describe('#1251×#1257 能力挡挂起：sweep 不失败收尾，可见态归 waitingOn + queue.blocked', () => {
  test('失败方式 8：钉选在线能力挡 → sweep 超任何宽限不做失败收尾（挂起等机器）', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-s1', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-s1', capabilities: { mcpServers: ['ctx'], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-s1', pinnedMachineId: 'm-s1' });

    // #1257 律：pending 步一律不动（挂起等机器，claim 循环自动续跑）。远超
    // 既有失联阈也照样不失败——能力挡不是 infra 事件，失败收尾会烧掉用户的步。
    sweepAbandonedBuildSteps(w.s.svc, w.base + BUILD_ABANDONED_STEP_MS * 10);
    expect(stepRowOf(w, target.id).status).toBe('pending');
    expect(buildRowOf(w, target.buildId).errorMessage).toBeNull();
  });

  test('失败方式 9：todo waitingOn 派生 = 等机器挂起；能力补齐即消失', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-s2', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-s2', capabilities: { mcpServers: ['ctx'], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-s2', pinnedMachineId: 'm-s2' });
    // waitingOn 派生要求在飞位：latestBuildId 指向本 build（phase queued ∈
    // IN_PROGRESS_PHASES；healthy 排队与挂起的分界 = 闸判，不是相位）。
    w.s.db
      .update(todoTable)
      .set({ latestBuildId: target.buildId })
      .where(eq(todoTable.id, target.todoId))
      .run();
    const todoRow = () =>
      w.s.db.select().from(todoTable).where(eq(todoTable.id, target.todoId)).get()!;

    // 钉选机在线、runtime 闸开、能力缺 → 板面挂起「等机器」（等待不解锁，
    // 装齐才解锁——修法文案在步级 queue.blocked 面，失败方式 5 已钉）。
    expect(toTodoRecord(w.s.svc, todoRow()).waitingOn).toEqual({ on: 'machine', retryAt: null });

    // 机器装上 figma（下一拍 presence 覆写的 DB 终态直写）→ 挂起态即消失
    //（正常排队：机器在、能领，只是没轮到）。
    w.s.db
      .update(machineTable)
      .set({ capabilities: { mcpServers: ['ctx', 'figma'], skills: [] } })
      .where(eq(machineTable.id, 'm-s2'))
      .run();
    expect(toTodoRecord(w.s.svc, todoRow()).waitingOn).toBeUndefined();
  });

  test('失败方式 7（chief）：能力挡的 pending 回合不被 sweep 触碰（挂起律同律）', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-s3', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-s3', capabilities: { mcpServers: [], skills: [] } });
    const target = insertPendingChiefStep(w, {
      agentId: 'agent-s3',
      pinnedMachineId: 'm-s3',
    });
    sweepAbandonedChiefSteps(w.s.svc, w.base + BUILD_ABANDONED_STEP_MS * 10);
    expect(stepRowOf(w, target.id).status).toBe('pending');
    const errRow = w.s.db
      .select()
      .from(chiefMessageTable)
      .where(eq(chiefMessageTable.id, `chief-err-${target.id}`))
      .get();
    expect(errRow).toBeUndefined();
  });
});
