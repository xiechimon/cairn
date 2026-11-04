import { machineRecordSchema } from '@cairn/shared';
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

describe('#1241 formula (recommended concurrency = clamp(min(cores, round(total memory / 2GiB)), 1, 16))', () => {
  test('F1 cores and memory each set an upper bound: fewer cores takes cores, less memory takes round(GiB/2)', () => {
    expect(
      recommendMachineConcurrency({ ...modest, cpuCores: 4, memoryTotalMb: 32 * MIB_PER_GIB }),
    ).toMatchObject({
      value: 4,
      source: 'measured',
    });
    expect(recommendMachineConcurrency(modest)).toMatchObject({ value: 3, source: 'measured' });
  });

  test('F1 upper edge 16: 64 GiB 32 cores does not exceed the write domain', () => {
    expect(recommendMachineConcurrency(roomy)).toMatchObject({ value: 16, source: 'measured' });
    expect(CONCURRENCY_CEILING).toBe(16);
  });

  test('F1 lower edge 1: total memory under 2 GiB still gives 1 slot', () => {
    expect(recommendMachineConcurrency({ ...weak, memoryTotalMb: 1500 })).toMatchObject({
      value: 1,
      source: 'measured',
    });
    expect(CONCURRENCY_FLOOR).toBe(1);
  });

  test('F1 memory looks only at the total: running steps eating available memory do not shrink the recommendation', () => {
    expect(recommendMachineConcurrency({ ...roomy, memoryAvailableMb: 512 })).toMatchObject({
      value: 16,
      source: 'measured',
    });
  });

  test('F2 no fingerprint / bad fingerprint / missing memoryTotalMb -> conservative default 3, marked estimate', () => {
    expect(recommendMachineConcurrency(undefined)).toMatchObject({ value: 3, source: 'estimate' });
    expect(recommendMachineConcurrency(null)).toMatchObject({ value: 3, source: 'estimate' });
    expect(recommendMachineConcurrency({ ...weak, cpuCores: 0 })).toMatchObject({
      value: 3,
      source: 'estimate',
    });
    const { memoryTotalMb: _legacy, ...legacyRow } = modest;
    expect(recommendMachineConcurrency(legacyRow)).toMatchObject({ value: 3, source: 'estimate' });
    expect(CONSERVATIVE_CONCURRENCY).toBe(3);
  });

  test('F3 valid range = 1..clamp(round(total memory / 1GiB), 1, 16); no fingerprint = 1..8', () => {
    const hw = (cpuCores: number, memoryTotalMb: number) => ({
      cpuCores,
      memoryTotalMb,
      memoryAvailableMb: 0,
      loadAvg1: 0,
      diskFreeMb: 0,
    });
    expect(recommendMachineConcurrency(hw(8, 16002))).toMatchObject({
      value: 8,
      range: { min: 1, max: 16 },
    });
    expect(recommendMachineConcurrency(hw(12, 36864))).toMatchObject({
      value: 12,
      range: { min: 1, max: 16 },
    });
    expect(recommendMachineConcurrency(hw(4, 1500))).toMatchObject({
      value: 1,
      range: { min: 1, max: 1 },
    });
    expect(recommendMachineConcurrency(undefined)).toMatchObject({
      value: 3,
      range: { min: 1, max: 8 },
    });
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

describe('#1241 priority: user > recommendation > conservative estimate (write point + read surface)', () => {
  test('F2 register without fingerprint -> maxConcurrent 3, source estimate', async () => {
    const w = await setupWorld();
    const r = await recordOf(w);
    expect(r).toMatchObject({
      maxConcurrent: 3,
      maxConcurrentOverridden: false,
      recommendedConcurrent: 3,
      concurrencySource: 'estimate',
    });
  });

  test('heartbeat carrying a fingerprint -> uncovered numbers follow the recommendation; source measured', async () => {
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

  test('F3 after user override the heartbeat does not change the number, recommendation still shown; source manual', async () => {
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

  test('F4 clearing the override (PATCH null) -> back to the current fingerprint recommendation', async () => {
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

  test('F5 heartbeat without hardware reuses the previous tick fingerprint, recommendation not knocked back to estimate', async () => {
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
