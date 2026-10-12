// #1251 可见 pending reason（排队投影 blocked 位 + 「有界等待」族 ④d 能力挡）：
// pending 成因区分「等机器上线」（等待有用）与「缺能力」（装 X 即解锁，给修法）
// ——Multica dispatch/reason.go 族语义对位（runtime_offline vs runtime_unusable
// 的分野：等待有没有用），落 pacman 既有两个漏斗：
// - 读侧 = stepQueueProjector 的 queue.blocked（step-queue.ts，#1108 排队投影
//   扩展位——transcript「排队中」行与 chief turnQueue 两面同源）；
// - 失败收尾侧 = sweepAbandonedBuildSteps / failAbandonedChiefSteps 的钉选
//   「有界等待」族（④/④b/④c 同漏斗新增 ④d：钉选机在线、runtime 闸开、
//   能力缺 → 超宽限失败收尾，文案点名机器 + 缺项 + 修法）。
// 失败方式（先于实现固化）：
// 1. 未钉 + 在线机全缺能力 → blocked capability-missing，missing 点名可读形。
// 2. 未钉 + 团队零在线机器 → blocked machine-offline（missing 空集）——
//    无 requiredCapabilities 的 agent 同样给（离线等待与能力无关，是事实）。
// 3. 有能力齐的在线机 → blocked 缺席（正常排队，零回归）。
// 4. fail-open 显示面同律：在线机未上报快照 → blocked 缺席（未知不编造缺项）。
// 5. 钉选离线机 → machine-offline；钉选在线缺能力机 → capability-missing。
// 6. runtime 闸挡（机器在线但没开 runtime）不冒充能力成因——既有已知缝
//    保持既有呈现（blocked 缺席），能力闸不越权。
// 7. chief 回合同律（turnQueue 投影 + chief sweep 失败收尾）。
// 8. sweep ④d：钉选在线能力缺 × 超宽限 → 步 failed + build.errorMessage
//    点名机器/缺项/修法，且**不是** wedge 文案（④c 判据须让位——能力挡的
//    机器「有闲位不领」是正确行为，不是楔住）。
// 9. 宽限内不动（有界等待律）；能力补齐后 sweep 不再失败收尾（可领即活）。

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
import { sweepAbandonedBuildSteps } from '../src/services/builds.js';
import { failAbandonedChiefSteps } from '../src/services/chief.js';
import { PIN_OFFLINE_GRACE_MS } from '../src/services/dispatch-timeouts.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
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
): { id: string; createdAt: number; pinnedMachineId: string | null; buildId: string } {
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
  return { id, createdAt, pinnedMachineId, buildId };
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

describe('#1251 sweep ④d：钉选机在线但能力挡（有界等待族）', () => {
  test('失败方式 8+9：超宽限 → 失败收尾，文案点名机器/缺项/修法且非 wedge；宽限内不动', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-s1', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-s1', capabilities: { mcpServers: ['ctx'], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-s1', pinnedMachineId: 'm-s1' });

    // 宽限内：不动（有界等待律——④/④b 同宽限同漏斗）。
    sweepAbandonedBuildSteps(w.s.svc, w.base + PIN_OFFLINE_GRACE_MS - 1_000);
    expect(stepRowOf(w, target.id).status).toBe('pending');
    expect(buildRowOf(w, target.buildId).errorMessage).toBeNull();

    // 超宽限：失败收尾，文案 = 点名机器 + 缺项可读形 + 修法（装 X 即解锁）。
    sweepAbandonedBuildSteps(w.s.svc, w.base + PIN_OFFLINE_GRACE_MS + 1_000);
    expect(stepRowOf(w, target.id).status).toBe('failed');
    const message = buildRowOf(w, target.buildId).errorMessage ?? '';
    expect(message).toContain('m-s1');
    expect(message).toContain('MCP server "figma"');
    // ④c wedge 判据须让位：能力挡的机器「有闲位不领」是正确行为。
    expect(message).not.toContain('空闲并发位');
  });

  test('失败方式 9：能力补齐后 ④d 不再触发（缺项文案消失）', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-s2', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-s2', capabilities: { mcpServers: ['ctx'], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-s2', pinnedMachineId: 'm-s2' });
    // 机器装上 figma（下一拍 presence 覆写的 DB 终态直写）。
    w.s.db
      .update(machineTable)
      .set({ capabilities: { mcpServers: ['ctx', 'figma'], skills: [] } })
      .where(eq(machineTable.id, 'm-s2'))
      .run();
    sweepAbandonedBuildSteps(w.s.svc, w.base + PIN_OFFLINE_GRACE_MS + 1_000);
    // 能力成因消失。本 world 无真 daemon 认领，超宽限后落到 ④c wedge 族
    //（在线有闲位不领 = 楔住）——那是另一族的既有判据，非本票语义：钉的是
    // 「缺项文案不再出现」。宽限内不动的判据在上一用例已钉。
    const message = buildRowOf(w, target.buildId).errorMessage ?? '';
    expect(message).not.toContain('MCP server "figma"');
    expect(message).not.toContain('缺少本步 Agent 要求的能力');
  });

  test('失败方式 7：chief 回合 sweep 同律（钉选在线能力缺 → chief_turn_error 点名缺项）', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-s3', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-s3', capabilities: { mcpServers: [], skills: [] } });
    const target = insertPendingChiefStep(w, {
      agentId: 'agent-s3',
      pinnedMachineId: 'm-s3',
    });
    failAbandonedChiefSteps(w.s.svc, w.base + PIN_OFFLINE_GRACE_MS + 1_000);
    expect(stepRowOf(w, target.id).status).toBe('failed');
    const errRow = w.s.db
      .select()
      .from(chiefMessageTable)
      .where(eq(chiefMessageTable.id, `chief-err-${target.id}`))
      .get();
    expect(errRow).toBeDefined();
    const content = JSON.parse(errRow!.content as string) as { message?: string };
    expect(content.message ?? '').toContain('MCP server "figma"');
    expect(content.message ?? '').toContain('m-s3');
  });
});
