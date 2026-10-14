// #1241 机器推荐并发：公式与优先级（用户 > 推荐 > 保守估算）。失败方式（先于实现固化，仓测试纪律）：
// F1 公式越界：核数 / 内存 / 下沿 1 / 上沿 16 任一项失守 → 推荐值错。
// F2 缺指纹不给估算标：无指纹或坏指纹没落 estimate（3），或误标 measured。
// F3 用户值被心跳覆盖：overridden 行的 maxConcurrent 随推荐值漂移（用户值不持久）。
// F4 清除覆盖不回推荐：PATCH null 后数字不跟当前硬件重算。
// F5 心跳缺 hardware 把已测推荐打回估算：一次探测失败掉回保守默认。

import { machineRecordSchema } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { agent as agentTable, machine as machineTable } from '../src/db/schema.js';
import {
  CONCURRENCY_CEILING,
  CONCURRENCY_FLOOR,
  CONSERVATIVE_CONCURRENCY,
  recommendMachineConcurrency,
} from '../src/services/dispatch-eligibility.js';
import { bootServer, issueApiKey, postProject, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const MIB_PER_GIB = 1024;
const roomy = {
  cpuCores: 32,
  memoryTotalMb: 64 * MIB_PER_GIB,
  memoryAvailableMb: 60 * MIB_PER_GIB,
  loadAvg1: 1,
  diskFreeMb: 100_000,
};
const modest = {
  cpuCores: 8,
  memoryTotalMb: 6 * MIB_PER_GIB,
  memoryAvailableMb: 4 * MIB_PER_GIB,
  loadAvg1: 0.5,
  diskFreeMb: 100_000,
};
const weak = {
  cpuCores: 2,
  memoryTotalMb: 2 * MIB_PER_GIB,
  memoryAvailableMb: 1 * MIB_PER_GIB,
  loadAvg1: 0.2,
  diskFreeMb: 50_000,
};

describe('#1241 公式（推荐并发 = clamp(min(核, floor(总内存 / 2GiB)), 1, 16)）', () => {
  test('F1 核数与内存各自作上界：核少取核，内存少取 floor(GiB/2)', () => {
    expect(
      recommendMachineConcurrency({ ...modest, cpuCores: 4, memoryTotalMb: 32 * MIB_PER_GIB }),
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

  test('F1 下沿 1：总内存不足 2 GiB 仍给 1 槽', () => {
    expect(recommendMachineConcurrency({ ...weak, memoryTotalMb: 1500 })).toEqual({
      value: 1,
      source: 'measured',
    });
    expect(CONCURRENCY_FLOOR).toBe(1);
  });

  test('F1 内存只看总量：运行中的步吃掉可用内存，推荐值不缩', () => {
    expect(recommendMachineConcurrency({ ...roomy, memoryAvailableMb: 512 })).toEqual({
      value: 16,
      source: 'measured',
    });
  });

  test('F2 无指纹 / 坏指纹 / 缺 memoryTotalMb → 保守默认 3，标 estimate', () => {
    expect(recommendMachineConcurrency(undefined)).toEqual({ value: 3, source: 'estimate' });
    expect(recommendMachineConcurrency(null)).toEqual({ value: 3, source: 'estimate' });
    expect(recommendMachineConcurrency({ ...weak, cpuCores: 0 })).toEqual({
      value: 3,
      source: 'estimate',
    });
    const { memoryTotalMb: _legacy, ...legacyRow } = modest;
    expect(recommendMachineConcurrency(legacyRow)).toEqual({ value: 3, source: 'estimate' });
    expect(CONSERVATIVE_CONCURRENCY).toBe(3);
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
  const s = bootServer();
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

describe('#1241 优先级：用户 > 推荐 > 保守估算（写点 + 读面）', () => {
  test('F2 注册未带指纹 → maxConcurrent 3，source estimate', async () => {
    const w = await setupWorld();
    const r = await recordOf(w);
    expect(r).toMatchObject({
      maxConcurrent: 3,
      maxConcurrentOverridden: false,
      recommendedConcurrent: 3,
      concurrencySource: 'estimate',
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
