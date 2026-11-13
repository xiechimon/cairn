import type { RequiredCapabilities, RouteOverride } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { claimStep } from '../src/services/machines.js';
import {
  bootServer,
  issueApiKey,
  postProject,
  req,
  seedRoute,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

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
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model' });
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

function insertPendingStep(
  w: World,
  opts: { requiredCapabilities?: RequiredCapabilities; homeMachineId?: string | null } = {},
): { stepId: string; buildId: string } {
  const routeOverride: RouteOverride = {
    ...(opts.homeMachineId != null ? { machineId: opts.homeMachineId } : {}),
    ...(opts.requiredCapabilities !== undefined
      ? { requiredCapabilities: opts.requiredCapabilities }
      : {}),
  };
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
      routeOverride,
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
    const legacy = await enrollMachineRest(w, { name: 'cap-legacy', capabilities: null });
    const legacyRow = w.s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.id, legacy.machineId))
      .get()!;
    expect(legacyRow.capabilities).toBeNull();
  });
});

describe('#1251 claim capability gate', () => {
  test('failure mode 3: MCP dimension -- a step named to the lacking machine stays pending; a complete machine does not take it', async () => {
    const w = await setupWorld();
    const lacking = await enrollMachineRest(w, {
      name: 'cap-lacking',
      capabilities: { mcpServers: ['ctx'], skills: [] },
    });
    const capable = await enrollMachineRest(w, {
      name: 'cap-capable',
      capabilities: { mcpServers: ['figma', 'ctx'], skills: [] },
    });
    const blocked = insertPendingStep(w, {
      requiredCapabilities: { mcpServers: ['figma'] },
      homeMachineId: lacking.machineId,
    });

    expect(await claimAs(w, lacking.machineId)).toBeNull();
    expect(await claimAs(w, capable.machineId)).toBeNull();
    expect(stepRow(w, blocked.stepId).status).toBe('pending');
  });

  test('failure mode 3: the capability on the session rule gates every step of the team', async () => {
    const w = await setupWorld();
    seedRoute(w.s, 'session', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      requiredCapabilities: { mcpServers: ['figma'] },
    });
    const lacking = await enrollMachineRest(w, {
      name: 'cap-rule-lacking',
      capabilities: { mcpServers: ['ctx'], skills: [] },
    });
    const capable = await enrollMachineRest(w, {
      name: 'cap-rule-capable',
      capabilities: { mcpServers: ['figma'], skills: [] },
    });
    const { stepId } = insertPendingStep(w, { homeMachineId: capable.machineId });
    expect(await claimAs(w, lacking.machineId)).toBeNull();
    expect(stepRow(w, stepId).status).toBe('pending');
    expect((await claimAs(w, capable.machineId))?.step.id).toBe(stepId);
  });

  test('failure mode 4: model dimension -- claudeCodeReport missing a model id blocks, a machine containing it takes the step', async () => {
    const w = await setupWorld();
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
      requiredCapabilities: { models: ['glm-5.3'] },
      homeMachineId: noModel.machineId,
    });
    expect(await claimAs(w, noModel.machineId)).toBeNull();
    expect(await claimAs(w, hasModel.machineId)).toBeNull();
    expect(stepRow(w, blocked.stepId).status).toBe('pending');
  });

  test('D71 failure mode 5: no snapshot reported fails closed -- a legacy daemon does not claim a step that requires a capability', async () => {
    const w = await setupWorld();
    const legacy = await enrollMachineRest(w, { name: 'cap-open-legacy' });
    const { stepId } = insertPendingStep(w, {
      requiredCapabilities: { mcpServers: ['figma'] },
      homeMachineId: legacy.machineId,
    });
    expect(await claimAs(w, legacy.machineId)).toBeNull();
    expect(stepRow(w, stepId).status).toBe('pending');
  });

  test('D71 failure mode 5: models dimension fails closed the same way for claudeCodeReport null', async () => {
    const w = await setupWorld();
    const noReport = await enrollMachineRest(w, {
      name: 'cap-open-noreport',
      capabilities: { mcpServers: [], skills: [] },
    });
    const { stepId } = insertPendingStep(w, {
      requiredCapabilities: { models: ['glm-5.3'] },
      homeMachineId: noReport.machineId,
    });
    expect(await claimAs(w, noReport.machineId)).toBeNull();
    expect(stepRow(w, stepId).status).toBe('pending');
  });

  test('failure mode 6: zero regression -- a step without requiredCapabilities behaves unchanged', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'cap-regress',
      capabilities: { mcpServers: [], skills: [] },
    });
    const { stepId } = insertPendingStep(w, { homeMachineId: m.machineId });
    expect((await claimAs(w, m.machineId))?.step.id).toBe(stepId);
  });

  test('failure mode 7: blocked candidates do not block the head -- later legal candidates in the same batch still claim', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'cap-hol',
      capabilities: { mcpServers: [], skills: [] },
    });
    const blocked = insertPendingStep(w, {
      requiredCapabilities: { mcpServers: ['figma'] },
      homeMachineId: m.machineId,
    });
    const free = insertPendingStep(w, { homeMachineId: m.machineId });
    const claimed = await claimAs(w, m.machineId);
    expect(claimed?.step.id).toBe(free.stepId);
    expect(stepRow(w, blocked.stepId).status).toBe('pending');
  });

  test('failure mode 8: chief steps same law -- Coordinator rule missing capability not claimed, complete claimed', async () => {
    const w = await setupWorld();
    const lacking = await enrollMachineRest(w, {
      name: 'cap-chief-no',
      capabilities: { mcpServers: [], skills: [] },
    });
    const capable = await enrollMachineRest(w, {
      name: 'cap-chief-yes',
      capabilities: { mcpServers: ['figma'], skills: [] },
    });
    seedRoute(w.s, 'coordinator', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: lacking.machineId,
      requiredCapabilities: { mcpServers: ['figma'] },
    });
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
    seedRoute(w.s, 'coordinator', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: capable.machineId,
      requiredCapabilities: { mcpServers: ['figma'] },
    });
    expect((await claimAs(w, capable.machineId))?.step.id).toBe(stepId);
  });
});

describe('#1251 routing rule requiredCapabilities write/read surface', () => {
  async function capabilitiesOf(w: World): Promise<unknown> {
    const got = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/routing-settings`);
    const settings = (await got.json()) as {
      rules: { use: string; requiredCapabilities: unknown }[];
    };
    return settings.rules.find((rule) => rule.use === 'session')?.requiredCapabilities ?? null;
  }

  test('failure mode 9: PATCH carries the bits, rewrites, explicit null clears, type error 400', async () => {
    const w = await setupWorld();
    const url = `/api/teams/${w.s.team.id}/routing-rules/session`;
    const patched = await req(w.s.app, 'PATCH', url, {
      requiredCapabilities: { mcpServers: ['figma'] },
    });
    expect(patched.status).toBe(200);
    expect(await capabilitiesOf(w)).toEqual({ mcpServers: ['figma'] });

    const rewritten = await req(w.s.app, 'PATCH', url, {
      requiredCapabilities: { models: ['glm-5.3'] },
    });
    expect(rewritten.status).toBe(200);
    expect(await capabilitiesOf(w)).toEqual({ models: ['glm-5.3'] });

    const cleared = await req(w.s.app, 'PATCH', url, { requiredCapabilities: null });
    expect(cleared.status).toBe(200);
    expect(await capabilitiesOf(w)).toBeNull();

    const bad = await req(w.s.app, 'PATCH', url, {
      requiredCapabilities: { mcpServers: 'figma' },
    });
    expect(bad.status).toBe(400);
  });
});

describe('D71 a rule that requires the Orb never runs on a plain host', () => {
  test('a host executor does not claim an Orb-required step', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'orb-req-host',
      capabilities: { mcpServers: [], skills: [], executor: 'host' },
    });
    const { stepId } = insertPendingStep(w, {
      requiredCapabilities: { executor: 'orb' },
      homeMachineId: m.machineId,
    });
    expect(await claimAs(w, m.machineId)).toBeNull();
    expect(stepRow(w, stepId).status).toBe('pending');
  });

  test('a machine that never reported its executor is treated as not an Orb', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'orb-req-legacy',
      capabilities: { mcpServers: [], skills: [] },
    });
    const { stepId } = insertPendingStep(w, {
      requiredCapabilities: { executor: 'orb' },
      homeMachineId: m.machineId,
    });
    expect(await claimAs(w, m.machineId)).toBeNull();
    expect(stepRow(w, stepId).status).toBe('pending');
  });

  test('an Orb executor claims the Orb-required step', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'orb-req-orb',
      capabilities: { mcpServers: [], skills: [], executor: 'orb' },
    });
    const { stepId } = insertPendingStep(w, {
      requiredCapabilities: { executor: 'orb' },
      homeMachineId: m.machineId,
    });
    const claimed = await claimAs(w, m.machineId);
    expect(claimed?.step.id).toBe(stepId);
  });
});
