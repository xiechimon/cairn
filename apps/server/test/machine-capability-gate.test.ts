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

let seqCounter = 9_850;

interface World {
  s: TestServer;
  projectId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 100 });
  disposables.push(() => s.dispose());
  const projectId = await postProject(s.app, 'capgate-proj');
  return { s, projectId };
}

async function enrollMachineRest(
  w: World,
  opts: {
    name: string;
    capabilities?: unknown;
    online?: boolean;
    runtimes?: string[];
    claudeCodeModels?: string[];
  },
): Promise<{ machineId: string; token: string }> {
  const apiKey = await issueApiKey(w.s);
  const res = await w.s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId: w.s.team.id,
      name: opts.name,
      cliVersion: '0.1.0',
      ...(opts.capabilities !== undefined ? { capabilities: opts.capabilities } : {}),
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { machineId: string; token: string };
  w.s.db
    .update(machineTable)
    .set({
      online: opts.online ?? true,
      enabledRuntimes: opts.runtimes ?? ['pi'],
      ...(opts.claudeCodeModels !== undefined
        ? {
            claudeCodeReport: {
              installed: true,
              hostname: opts.name,
              models: opts.claudeCodeModels.map((id) => ({ id, name: id })),
            },
          }
        : {}),
    })
    .where(eq(machineTable.id, body.machineId))
    .run();
  return body;
}

function insertAgent(
  w: World,
  opts: {
    id: string;
    requiredCapabilities?: { mcpServers?: string[]; models?: string[] } | null;
    mcpServers?: string[];
    modelId?: string | null;
  },
): void {
  w.s.db
    .insert(agentTable)
    .values({
      id: opts.id,
      teamId: w.s.team.id,
      displayName: opts.id,
      status: 'active',
      avatarUrl: null,
      provider: 'stub-gw',
      modelId: opts.modelId === undefined ? 'stub-model' : opts.modelId,
      thinkingLevel: null,
      tools: [],
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: opts.mcpServers ?? [],
      maxConcurrentTasks: null,
      requiredCapabilities: opts.requiredCapabilities ?? null,
    })
    .run();
}

function insertPendingStep(
  w: World,
  opts: { agentId: string; homeMachineId?: string | null },
): { stepId: string; buildId: string } {
  w.s.db
    .update(agentTable)
    .set({ machineId: opts.homeMachineId ?? null })
    .where(eq(agentTable.id, opts.agentId))
    .run();
  const suffix = Math.random().toString(36).slice(2, 8);
  seqCounter += 1;
  const now = seqCounter;
  const todoId = `todo-cap-${suffix}`;
  const buildId = `build-cap-${suffix}`;
  const stepId = `step-cap-${suffix}`;
  w.s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: w.s.team.id,
      projectId: w.projectId,
      seqNum: seqCounter,
      title: `能力闸任务 ${suffix}`,
      spec: '探针',
      phase: 'queued',
      phaseAt: now,
      assignment: { plan: null, build: { agentId: opts.agentId } },
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
      createdAt: now,
    })
    .run();
  w.s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt: now + 1,
    })
    .run();
  return { stepId, buildId };
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

function claimAs(w: World, machineId: string) {
  return claimStep(machineDepsOf(w), machineId, w.s.team.id, 10, 'http://localhost');
}

function presenceAs(w: World, token: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    w.s.app.request('/api/machine/presence', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function stepRow(w: World, stepId: string) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
}

describe('#1251 capability report persistence + heartbeat red line', () => {
  test('failure mode 1: enroll carrying capabilities -> column persisted and exposed through the record', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'cap-enroll',
      capabilities: { mcpServers: ['figma'], skills: ['verify-cairn'] },
    });
    const row = w.s.db.select().from(machineTable).where(eq(machineTable.id, m.machineId)).get()!;
    expect(row.capabilities).toEqual({ mcpServers: ['figma'], skills: ['verify-cairn'] });
    const me = await w.s.app.request('/api/machine/me', {
      headers: { authorization: `Bearer ${m.token}` },
    });
    const meBody = (await me.json()) as { capabilities?: unknown };
    expect(meBody.capabilities).toEqual({ mcpServers: ['figma'], skills: ['verify-cairn'] });
    const list = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/machines`);
    const listBody = (await list.json()) as { machines?: unknown[] } | unknown[];
    const machines = Array.isArray(listBody) ? listBody : (listBody.machines ?? []);
    const mine = (machines as { id: string; capabilities?: unknown }[]).find(
      (r) => r.id === m.machineId,
    );
    expect(mine?.capabilities).toEqual({ mcpServers: ['figma'], skills: ['verify-cairn'] });
  });

  test('failure mode 1: presence carrying capabilities -> overwrites the column', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'cap-presence',
      capabilities: { mcpServers: [], skills: [] },
    });
    const res = await presenceAs(w, m.token, {
      cliVersion: '0.1.0',
      capabilities: { mcpServers: ['ctx'], skills: [] },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = w.s.db.select().from(machineTable).where(eq(machineTable.id, m.machineId)).get()!;
    expect(row.capabilities).toEqual({ mcpServers: ['ctx'], skills: [] });
  });

  test('failure mode 2: presence capabilities bad shape -> 200 {ok:true}, old value kept (heartbeat red line)', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'cap-tolerant',
      capabilities: { mcpServers: ['figma'], skills: [] },
    });
    for (const bad of [{ mcpServers: 'oops' }, 42, 'x', [1], { mcpServers: [1], skills: [] }]) {
      const res = await presenceAs(w, m.token, { capabilities: bad });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    const row = w.s.db.select().from(machineTable).where(eq(machineTable.id, m.machineId)).get()!;
    expect(row.capabilities).toEqual({ mcpServers: ['figma'], skills: [] });
  });

  test('failure mode 2: presence defaults capabilities -> 200, old value kept; never reported -> column null', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'cap-absent',
      capabilities: { mcpServers: ['figma'], skills: [] },
    });
    const res = await presenceAs(w, m.token, { cliVersion: '0.1.0' });
    expect(res.status).toBe(200);
    const row = w.s.db.select().from(machineTable).where(eq(machineTable.id, m.machineId)).get()!;
    expect(row.capabilities).toEqual({ mcpServers: ['figma'], skills: [] });
    const legacy = await enrollMachineRest(w, { name: 'cap-legacy' });
    const legacyRow = w.s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.id, legacy.machineId))
      .get()!;
    expect(legacyRow.capabilities).toBeNull();
  });
});

describe('#1251 claim capability gate', () => {
  test('failure mode 3: MCP dimension -- machine missing slug claims empty and stays pending, complete one claims', async () => {
    const w = await setupWorld();
    insertAgent(w, { id: 'agent-cap-mcp-a', requiredCapabilities: { mcpServers: ['figma'] } });
    insertAgent(w, { id: 'agent-cap-mcp-b', requiredCapabilities: { mcpServers: ['figma'] } });
    const lacking = await enrollMachineRest(w, {
      name: 'cap-lacking',
      capabilities: { mcpServers: ['ctx'], skills: [] },
    });
    const capable = await enrollMachineRest(w, {
      name: 'cap-capable',
      capabilities: { mcpServers: ['figma', 'ctx'], skills: [] },
    });
    const blocked = insertPendingStep(w, {
      agentId: 'agent-cap-mcp-a',
      homeMachineId: lacking.machineId,
    });
    const runnable = insertPendingStep(w, {
      agentId: 'agent-cap-mcp-b',
      homeMachineId: capable.machineId,
    });

    expect(await claimAs(w, lacking.machineId)).toBeNull();
    expect(stepRow(w, blocked.stepId).status).toBe('pending');

    const claimed = await claimAs(w, capable.machineId);
    expect(claimed?.step.id).toBe(runnable.stepId);
    expect(stepRow(w, runnable.stepId).status).toBe('claimed');
  });

  test('failure mode 4: model dimension -- claudeCodeReport missing a model id blocks, containing it allows', async () => {
    const w = await setupWorld();
    insertAgent(w, { id: 'agent-cap-model-a', requiredCapabilities: { models: ['glm-5.3'] } });
    insertAgent(w, { id: 'agent-cap-model-b', requiredCapabilities: { models: ['glm-5.3'] } });
    const noModel = await enrollMachineRest(w, {
      name: 'cap-model-no',
      capabilities: { mcpServers: [], skills: [] },
      claudeCodeModels: ['other-model'],
    });
    const hasModel = await enrollMachineRest(w, {
      name: 'cap-model-yes',
      capabilities: { mcpServers: [], skills: [] },
      claudeCodeModels: ['glm-5.3'],
    });
    const blocked = insertPendingStep(w, {
      agentId: 'agent-cap-model-a',
      homeMachineId: noModel.machineId,
    });
    const runnable = insertPendingStep(w, {
      agentId: 'agent-cap-model-b',
      homeMachineId: hasModel.machineId,
    });
    expect(await claimAs(w, noModel.machineId)).toBeNull();
    expect(stepRow(w, blocked.stepId).status).toBe('pending');
    expect((await claimAs(w, hasModel.machineId))?.step.id).toBe(runnable.stepId);
  });

  test('failure mode 5: no snapshot reported fail-open -- legacy daemon machines still claim', async () => {
    const w = await setupWorld();
    insertAgent(w, { id: 'agent-cap-open', requiredCapabilities: { mcpServers: ['figma'] } });
    const legacy = await enrollMachineRest(w, { name: 'cap-open-legacy' });
    const { stepId } = insertPendingStep(w, {
      agentId: 'agent-cap-open',
      homeMachineId: legacy.machineId,
    });
    expect((await claimAs(w, legacy.machineId))?.step.id).toBe(stepId);
  });

  test('failure mode 5: models dimension fail-open same law for claudeCodeReport null', async () => {
    const w = await setupWorld();
    insertAgent(w, { id: 'agent-cap-open2', requiredCapabilities: { models: ['glm-5.3'] } });
    const noReport = await enrollMachineRest(w, {
      name: 'cap-open-noreport',
      capabilities: { mcpServers: [], skills: [] },
    });
    const { stepId } = insertPendingStep(w, {
      agentId: 'agent-cap-open2',
      homeMachineId: noReport.machineId,
    });
    expect((await claimAs(w, noReport.machineId))?.step.id).toBe(stepId);
  });

  test('failure mode 6: zero regression -- agent without requiredCapabilities behaves unchanged', async () => {
    const w = await setupWorld();
    insertAgent(w, { id: 'agent-cap-none' });
    const m = await enrollMachineRest(w, {
      name: 'cap-regress',
      capabilities: { mcpServers: [], skills: [] },
    });
    const { stepId } = insertPendingStep(w, {
      agentId: 'agent-cap-none',
      homeMachineId: m.machineId,
    });
    expect((await claimAs(w, m.machineId))?.step.id).toBe(stepId);
  });

  test('failure mode 7: blocked candidates do not block the head -- later legal candidates in the same batch still claim', async () => {
    const w = await setupWorld();
    insertAgent(w, { id: 'agent-cap-blocked', requiredCapabilities: { mcpServers: ['figma'] } });
    insertAgent(w, { id: 'agent-cap-free' });
    const m = await enrollMachineRest(w, {
      name: 'cap-hol',
      capabilities: { mcpServers: [], skills: [] },
    });
    const blocked = insertPendingStep(w, {
      agentId: 'agent-cap-blocked',
      homeMachineId: m.machineId,
    });
    const free = insertPendingStep(w, { agentId: 'agent-cap-free', homeMachineId: m.machineId });
    const claimed = await claimAs(w, m.machineId);
    expect(claimed?.step.id).toBe(free.stepId);
    expect(stepRow(w, blocked.stepId).status).toBe('pending');
  });

  test('failure mode 8: chief steps same law -- bound Agent missing capability not claimed, complete claimed', async () => {
    const w = await setupWorld();
    insertAgent(w, { id: 'agent-cap-chief', requiredCapabilities: { mcpServers: ['figma'] } });
    const lacking = await enrollMachineRest(w, {
      name: 'cap-chief-no',
      capabilities: { mcpServers: [], skills: [] },
    });
    const capable = await enrollMachineRest(w, {
      name: 'cap-chief-yes',
      capabilities: { mcpServers: ['figma'], skills: [] },
    });
    w.s.db
      .update(agentTable)
      .set({ machineId: lacking.machineId })
      .where(eq(agentTable.id, 'agent-cap-chief'))
      .run();
    const suffix = Math.random().toString(36).slice(2, 8);
    const now = Date.now();
    const chiefId = `chief-cap-${suffix}`;
    const threadId = `chief-thread-cap-${suffix}`;
    const stepId = `step-chief-cap-${suffix}`;
    w.s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        agentId: 'agent-cap-chief',
        charter: '',
        createdAt: now,
      })
      .run();
    w.s.db
      .insert(chiefThreadTable)
      .values({
        id: threadId,
        chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        title: '能力闸 chief 线程',
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
    w.s.db
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
    expect(await claimAs(w, lacking.machineId)).toBeNull();
    expect(stepRow(w, stepId).status).toBe('pending');
    w.s.db
      .update(agentTable)
      .set({ machineId: capable.machineId })
      .where(eq(agentTable.id, 'agent-cap-chief'))
      .run();
    expect((await claimAs(w, capable.machineId))?.step.id).toBe(stepId);
  });
});

describe('#1251 agent requiredCapabilities write/read surface', () => {
  test('failure mode 9: POST create carries the bits, PATCH rewrites, explicit null clears, type error 400', async () => {
    const w = await setupWorld();
    const home = await enrollMachineRest(w, { name: 'cap-write-home' });
    const created = await req(w.s.app, 'POST', `/api/teams/${w.s.team.id}/agents`, {
      displayName: 'cap-agent',
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: home.machineId,
      requiredCapabilities: { mcpServers: ['figma'] },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const got = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/agents/${id}`);
    expect(((await got.json()) as { requiredCapabilities?: unknown }).requiredCapabilities).toEqual(
      { mcpServers: ['figma'] },
    );

    const patched = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${id}`, {
      requiredCapabilities: { models: ['glm-5.3'] },
    });
    expect(patched.status).toBe(200);
    const got2 = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/agents/${id}`);
    expect(
      ((await got2.json()) as { requiredCapabilities?: unknown }).requiredCapabilities,
    ).toEqual({ models: ['glm-5.3'] });

    const cleared = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${id}`, {
      requiredCapabilities: null,
    });
    expect(cleared.status).toBe(200);
    const got3 = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/agents/${id}`);
    expect(
      ((await got3.json()) as { requiredCapabilities?: unknown }).requiredCapabilities ?? null,
    ).toBeNull();

    const bad = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${id}`, {
      requiredCapabilities: { mcpServers: 'figma' },
    });
    expect(bad.status).toBe(400);
  });

  test('failure mode 9: members list read surface follows the row (agent list = members embedded actor)', async () => {
    const w = await setupWorld();
    insertAgent(w, { id: 'agent-cap-members', requiredCapabilities: { mcpServers: ['ctx'] } });
    const res = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/members`);
    const body = (await res.json()) as {
      memberType: string;
      actor?: { id: string; requiredCapabilities?: unknown };
    }[];
    const row = body.find((m) => m.actor?.id === 'agent-cap-members');
    expect(row?.actor?.requiredCapabilities).toEqual({ mcpServers: ['ctx'] });
  });
});

describe('#1251 machine-fit read surface (agent surface "which machines can run it")', () => {
  test('failure mode 10: canRun/missing/mcpGaps/runtimeOk four states', async () => {
    const w = await setupWorld();
    insertAgent(w, {
      id: 'agent-fit',
      requiredCapabilities: { mcpServers: ['figma'] },
      mcpServers: ['figma', 'ctx'],
    });
    const capable = await enrollMachineRest(w, {
      name: 'fit-capable',
      capabilities: { mcpServers: ['figma'], skills: [] },
    });
    const lacking = await enrollMachineRest(w, {
      name: 'fit-lacking',
      capabilities: { mcpServers: ['ctx'], skills: [] },
    });
    const legacy = await enrollMachineRest(w, { name: 'fit-legacy' });
    const noRuntime = await enrollMachineRest(w, {
      name: 'fit-noruntime',
      capabilities: { mcpServers: ['figma'], skills: [] },
      runtimes: [],
    });

    const res = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/agents/agent-fit/machine-fit`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      machines: {
        machineId: string;
        name: string;
        online: boolean;
        runtimeOk: boolean;
        missing: string[] | null;
        mcpGaps: string[] | null;
        canRun: boolean;
      }[];
    };
    const byId = Object.fromEntries(body.machines.map((m) => [m.machineId, m]));

    expect(byId[capable.machineId]).toMatchObject({
      runtimeOk: true,
      missing: [],
      canRun: true,
      mcpGaps: ['ctx'],
    });
    expect(byId[lacking.machineId]).toMatchObject({
      runtimeOk: true,
      missing: ['MCP server "figma"'],
      canRun: false,
      mcpGaps: ['figma'],
    });
    expect(byId[legacy.machineId]).toMatchObject({
      runtimeOk: true,
      missing: null,
      mcpGaps: null,
      canRun: true,
    });
    expect(byId[noRuntime.machineId]).toMatchObject({ runtimeOk: false, canRun: false });
  });
});
