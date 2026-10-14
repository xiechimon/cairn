// #1241 机器推荐并发：公式、优先级（用户 > 推荐 > 保守估算）、负载暂停的滞回与
// claim 闸。失败方式（先于实现固化，仓测试纪律）：
// F1 公式越界：核数 / 内存 / 下沿 1 / 上沿 16 任一项失守 → 推荐值错。
// F2 缺指纹不给估算标：无指纹或坏指纹没落 estimate（3），或误标 measured。
// F3 用户值被心跳覆盖：overridden 行的 maxConcurrent 随推荐值漂移（用户值不持久）。
// F4 清除覆盖不回推荐：PATCH null 后数字不跟当前硬件重算。
// F5 心跳缺 hardware 把已测推荐打回估算：一次探测失败掉回保守默认。
// F6 滞回失效：越阈暂停后只要回到阈下就恢复（抖动），或覆盖时仍被暂停（server 加封顶）。
// F7 暂停误杀在跑步：暂停只该挡新 claim，不改在跑步（此处以 claim 结果验证）。

import { machineRecordSchema } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  CONCURRENCY_CEILING,
  CONCURRENCY_FLOOR,
  CONSERVATIVE_CONCURRENCY,
  nextConcurrencyPaused,
  recommendMachineConcurrency,
} from '../src/services/dispatch-eligibility.js';
import { claimStep } from '../src/services/machines.js';
import { bootServer, issueApiKey, postProject, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const MIB_PER_GIB = 1024;
const roomy = {
  cpuCores: 32,
  memoryAvailableMb: 64 * MIB_PER_GIB,
  loadAvg1: 1,
  diskFreeMb: 100_000,
};
const modest = {
  cpuCores: 8,
  memoryAvailableMb: 6 * MIB_PER_GIB,
  loadAvg1: 0.5,
  diskFreeMb: 100_000,
};
const weak = { cpuCores: 2, memoryAvailableMb: 2 * MIB_PER_GIB, loadAvg1: 0.2, diskFreeMb: 50_000 };
const overloaded = { ...weak, loadAvg1: 5 };

describe('#1241 公式（推荐并发 = clamp(min(核, floor(可用内存 / 2GiB)), 1, 16)）', () => {
  test('F1 核数与内存各自作上界：核少取核，内存少取 floor(GiB/2)', () => {
    expect(
      recommendMachineConcurrency({ ...modest, cpuCores: 4, memoryAvailableMb: 32 * MIB_PER_GIB }),
    ).toEqual({
      value: 4,
      source: 'measured',
    });
    expect(recommendMachineConcurrency(modest)).toEqual({ value: 3, source: 'measured' });
  });

  test('F1 上沿 16：64 GiB 32 核不超写域', () => {
    expect(recommendMachineConcurrency(roomy)).toEqual({ value: 16, source: 'measured' });
    expect(CONCURRENCY_CEILING).toBe(16);
  });

  test('F1 下沿 1：可用内存不足 2 GiB 仍给 1 槽', () => {
    expect(recommendMachineConcurrency({ ...weak, memoryAvailableMb: 1500 })).toEqual({
      value: 1,
      source: 'measured',
    });
    expect(CONCURRENCY_FLOOR).toBe(1);
  });

  test('F2 无指纹 / 坏指纹 → 保守默认 3，标 estimate', () => {
    expect(recommendMachineConcurrency(undefined)).toEqual({ value: 3, source: 'estimate' });
    expect(recommendMachineConcurrency(null)).toEqual({ value: 3, source: 'estimate' });
    expect(recommendMachineConcurrency({ ...weak, cpuCores: 0 })).toEqual({
      value: 3,
      source: 'estimate',
    });
    expect(CONSERVATIVE_CONCURRENCY).toBe(3);
  });
});

describe('#1241 负载暂停滞回（进线 > 1.5 × 核 或 内存 < 512 MiB；出线 ≤ 1 × 核 且 内存 ≥ 1 GiB）', () => {
  const fourCores = { cpuCores: 4, memoryAvailableMb: 8 * MIB_PER_GIB, loadAvg1: 1, diskFreeMb: 1 };

  test('F6 进线：负载超 1.5 × 核 → 暂停；恰等于阈值不暂停', () => {
    expect(nextConcurrencyPaused(false, { ...fourCores, loadAvg1: 6.5 })).toBe(true);
    expect(nextConcurrencyPaused(false, { ...fourCores, loadAvg1: 6 })).toBe(false);
  });

  test('F6 进线：内存低于 512 MiB → 暂停', () => {
    expect(nextConcurrencyPaused(false, { ...fourCores, memoryAvailableMb: 400 })).toBe(true);
  });

  test('F6 滞回：暂停中负载落在两条线之间仍保持暂停', () => {
    expect(nextConcurrencyPaused(true, { ...fourCores, loadAvg1: 5 })).toBe(true);
  });

  test('F6 出线：负载回到 1 × 核且内存回到 1 GiB 才恢复；内存未回不恢复', () => {
    expect(nextConcurrencyPaused(true, { ...fourCores, loadAvg1: 3.9 })).toBe(false);
    expect(
      nextConcurrencyPaused(true, { ...fourCores, loadAvg1: 3.9, memoryAvailableMb: 800 }),
    ).toBe(true);
  });

  test('F2 无指纹 → 不暂停（没有依据就不造暂停）', () => {
    expect(nextConcurrencyPaused(true, undefined)).toBe(false);
    expect(nextConcurrencyPaused(false, null)).toBe(false);
  });
});

interface World {
  s: TestServer;
  machineId: string;
  token: string;
  projectId: string;
}

const AGENT_ID = 'agent-rec-1';

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 100 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'rec-mbp', cliVersion: '0.1.0' }),
  });
  expect(res.status).toBe(200);
  const { token } = (await res.json()) as { token: string };
  const machineId = s.db
    .select()
    .from(machineTable)
    .where(eq(machineTable.name, 'rec-mbp'))
    .get()!.id;
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'rec-agent',
      machineId,
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
  const projectId = await postProject(s.app, 'rec-proj');
  return { s, machineId, token, projectId };
}

function presence(w: World, capabilities: unknown): Promise<Response> {
  return Promise.resolve(
    w.s.app.request('/api/machine/presence', {
      method: 'POST',
      headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities }),
    }),
  );
}

async function recordOf(w: World) {
  const res = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/machines`);
  const list = machineRecordSchema.array().parse(await res.json());
  return list.find((m) => m.id === w.machineId)!;
}

async function patchMaxConcurrent(w: World, maxConcurrent: number | null): Promise<void> {
  const res = await req(w.s.app, 'PATCH', `/api/machines/${w.machineId}`, { maxConcurrent });
  expect(res.status).toBe(200);
}

let seqNum = 20_000;

function insertPendingStep(w: World): string {
  seqNum += 1;
  const suffix = Math.random().toString(36).slice(2, 8);
  const stepId = `step-rec-${suffix}`;
  w.s.db
    .insert(todoTable)
    .values({
      id: `todo-rec-${suffix}`,
      teamId: w.s.team.id,
      projectId: w.projectId,
      seqNum,
      title: `推荐并发探针 ${suffix}`,
      spec: '探针',
      phase: 'queued',
      phaseAt: Date.now(),
      assignment: { plan: null, build: { agentId: AGENT_ID } },
    })
    .run();
  w.s.db
    .insert(buildTable)
    .values({
      id: `build-rec-${suffix}`,
      todoId: `todo-rec-${suffix}`,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: Date.now(),
    })
    .run();
  w.s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: `build-rec-${suffix}`,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt: Date.now(),
    })
    .run();
  return stepId;
}

function claimAs(w: World) {
  return claimStep(
    {
      ...w.s.svc,
      box: w.s.secretBox,
      reposDir: w.s.reposDir,
      attachmentsDir: w.s.attachmentsDir,
      skillsDir: w.s.skillsDir,
    },
    w.machineId,
    w.s.team.id,
    10,
    'http://localhost',
  );
}

describe('#1241 优先级：用户 > 推荐 > 保守估算（写点 + 读面）', () => {
  test('F2 注册未带指纹 → maxConcurrent 3，source estimate，无暂停', async () => {
    const w = await setupWorld();
    const r = await recordOf(w);
    expect(r).toMatchObject({
      maxConcurrent: 3,
      maxConcurrentOverridden: false,
      recommendedConcurrent: 3,
      concurrencySource: 'estimate',
      concurrencyPaused: false,
    });
  });

  test('心跳带指纹 → 未覆盖的数跟随推荐值；source measured', async () => {
    const w = await setupWorld();
    expect((await presence(w, { mcpServers: [], skills: [], hardware: roomy })).status).toBe(200);
    expect(await recordOf(w)).toMatchObject({
      maxConcurrent: 16,
      recommendedConcurrent: 16,
      concurrencySource: 'measured',
    });
    expect((await presence(w, { mcpServers: [], skills: [], hardware: weak })).status).toBe(200);
    expect(await recordOf(w)).toMatchObject({ maxConcurrent: 1, recommendedConcurrent: 1 });
  });

  test('F3 用户覆盖后心跳不改数，推荐值照常显示；source manual', async () => {
    const w = await setupWorld();
    await presence(w, { mcpServers: [], skills: [], hardware: roomy });
    await patchMaxConcurrent(w, 5);
    await presence(w, { mcpServers: [], skills: [], hardware: weak });
    expect(await recordOf(w)).toMatchObject({
      maxConcurrent: 5,
      maxConcurrentOverridden: true,
      recommendedConcurrent: 1,
      concurrencySource: 'manual',
    });
  });

  test('F4 清除覆盖（PATCH null）→ 回到当前指纹的推荐值', async () => {
    const w = await setupWorld();
    await presence(w, { mcpServers: [], skills: [], hardware: roomy });
    await patchMaxConcurrent(w, 5);
    await patchMaxConcurrent(w, null);
    expect(await recordOf(w)).toMatchObject({
      maxConcurrent: 16,
      maxConcurrentOverridden: false,
      concurrencySource: 'measured',
    });
  });

  test('F5 心跳缺 hardware 沿用上一拍指纹，推荐不被打回估算', async () => {
    const w = await setupWorld();
    await presence(w, { mcpServers: [], skills: [], hardware: roomy });
    await presence(w, { mcpServers: ['figma'], skills: [] });
    expect(await recordOf(w)).toMatchObject({
      maxConcurrent: 16,
      concurrencySource: 'measured',
      capabilities: { mcpServers: ['figma'], skills: [], hardware: roomy },
    });
  });
});

describe('#1241 负载暂停：只挡自动路径的新 claim（F6 / F7）', () => {
  test('自动路径过载 → 新 claim 空手，步留 pending；回落后领取', async () => {
    const w = await setupWorld();
    const stepId = insertPendingStep(w);
    await presence(w, { mcpServers: [], skills: [], hardware: overloaded });
    expect((await recordOf(w)).concurrencyPaused).toBe(true);
    expect(await claimAs(w)).toBeNull();
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status).toBe(
      'pending',
    );

    await presence(w, { mcpServers: [], skills: [], hardware: weak });
    expect((await recordOf(w)).concurrencyPaused).toBe(false);
    expect((await claimAs(w))?.step.id).toBe(stepId);
  });

  test('F7 暂停不改在跑步：已 claim 的步保持在跑，暂停只挡下一次领取', async () => {
    const w = await setupWorld();
    const first = insertPendingStep(w);
    await presence(w, { mcpServers: [], skills: [], hardware: roomy });
    expect((await claimAs(w))?.step.id).toBe(first);
    const second = insertPendingStep(w);
    await presence(w, { mcpServers: [], skills: [], hardware: overloaded });
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, first)).get()!.status).toBe(
      'claimed',
    );
    expect(await claimAs(w)).toBeNull();
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, second)).get()!.status).toBe(
      'pending',
    );
  });

  test('F6 用户覆盖后暂停位对读面与 claim 都不生效（用户的数是闸）', async () => {
    const w = await setupWorld();
    const stepId = insertPendingStep(w);
    await presence(w, { mcpServers: [], skills: [], hardware: overloaded });
    await patchMaxConcurrent(w, 4);
    expect((await recordOf(w)).concurrencyPaused).toBe(false);
    expect((await claimAs(w))?.step.id).toBe(stepId);
  });
});
