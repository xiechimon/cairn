import { chiefDigestThreadId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  provider as providerTable,
  step as stepTable,
  team as teamTable,
} from '../src/db/schema.js';
import { setCoordinatorMachineId } from '../src/services/coordinator-context.js';
import { claimStep } from '../src/services/machines.js';
import { bootServer, issueApiKey, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});
afterEach(() => setCoordinatorMachineId(null));

const AGENT_ID = 'agent-coord-sidecar';

interface World {
  s: TestServer;
  daemonId: string;
  sidecarId: string;
  sidecarToken: string;
  daemonToken: string;
  chiefId: string;
}

async function enroll(s: TestServer, key: string, name: string) {
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name, cliVersion: '99.0.0' }),
  });
  expect(res.status).toBe(200);
  const { token } = (await res.json()) as { token: string };
  const id = s.db.select().from(machineTable).where(eq(machineTable.name, name)).get()!.id;
  return { id, token };
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 10 });
  disposables.push(() => s.dispose());
  const daemon = await enroll(s, await issueApiKey(s), 'coord-daemon');
  const sidecar = await enroll(s, await issueApiKey(s), 'coord-sidecar');
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'Coordinator',
      machineId: daemon.id,
      status: 'active',
      avatarUrl: null,
      provider: 'stub-gw',
      modelId: 'stub-model',
      thinkingLevel: null,
      tools: [],
      secrets: [],
      skillsAllowlist: null,
      mcpServers: [],
    })
    .run();
  const chiefId = `chief-${s.svc.user.id}-${s.team.id}`;
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      agentId: AGENT_ID,
      charter: '',
      createdAt: 1,
    })
    .onConflictDoUpdate({ target: chiefTable.id, set: { agentId: AGENT_ID } })
    .run();
  return {
    s,
    daemonId: daemon.id,
    daemonToken: daemon.token,
    sidecarId: sidecar.id,
    sidecarToken: sidecar.token,
    chiefId,
  };
}

let seq = 0;

function insertChiefStep(w: World, opts: { threadId?: string; createdAt?: number } = {}): string {
  seq += 1;
  const threadId = opts.threadId ?? `chief-coord-${seq}`;
  const now = opts.createdAt ?? 1_000 + seq;
  if (!w.s.db.select().from(chiefThreadTable).where(eq(chiefThreadTable.id, threadId)).get()) {
    w.s.db
      .insert(chiefThreadTable)
      .values({
        id: threadId,
        chiefId: w.chiefId,
        userId: w.s.svc.user.id,
        teamId: w.s.team.id,
        title: 'coordinator',
        createdAt: now,
        updatedAt: now,
        sessionRuntime: 'pi',
        sessionId: '',
        sessionOpenedAt: now,
        pendingSessionResumeAt: null,
        toolDefHashes: {},
        toolResultHashes: {},
        activeRun: null,
        archivedAt: now,
      })
      .run();
  }
  const stepId = `step-coord-${seq}`;
  w.s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: threadId,
      kind: 'chief',
      machineId: null,
      status: 'pending',
      prompt: 'status?',
      createdAt: now,
    })
    .run();
  return stepId;
}

function deps(w: World) {
  return {
    ...w.s.svc,
    box: w.s.secretBox,
    reposDir: w.s.reposDir,
    attachmentsDir: w.s.attachmentsDir,
    skillsDir: w.s.skillsDir,
  };
}

function claimAsDaemon(w: World) {
  return claimStep(deps(w), w.daemonId, w.s.team.id, 10, 'http://localhost');
}

function claimAsCoordinator(w: World, machineId = w.sidecarId) {
  return claimStep(deps(w), machineId, w.s.team.id, 10, 'http://localhost', undefined, {
    role: 'coordinator',
  });
}

function statusOf(w: World, stepId: string) {
  const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
  return { status: row.status, machineId: row.machineId };
}

function bindClaudeCodeCoordinator(w: World): void {
  w.s.db
    .update(agentTable)
    .set({ provider: 'claude-code', modelId: 'haiku' })
    .where(eq(agentTable.id, AGENT_ID))
    .run();
  w.s.db
    .update(machineTable)
    .set({
      enabledRuntimes: ['pi', 'claude-code'],
      claudeCodeReport: {
        installed: true,
        hostname: 'daemon',
        models: [],
        auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
      } as never,
    })
    .where(eq(machineTable.id, w.daemonId))
    .run();
}

function addKeyedAnthropicProvider(w: World): void {
  w.s.db
    .insert(providerTable)
    .values({
      id: 'prov-anthropic',
      teamId: w.s.team.id,
      providerId: 'anthropic-byok',
      label: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      api: 'anthropic-messages',
      compat: {},
      models: [{ id: 'claude-haiku-5-5', name: 'Haiku 5.5' }],
      apiKeyCipher: 'sealed',
      createdBy: w.s.svc.user.id,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
}

function setClaudeUsage(w: World, claudeUsage: 'allow-paid' | 'subscription-only'): void {
  w.s.db.update(teamTable).set({ claudeUsage }).where(eq(teamTable.id, w.s.team.id)).run();
}

describe('Coordinator sidecar claim routing (D72)', () => {
  test('flag off: the coordinator role claims nothing and the daemon keeps Coordinator turns', async () => {
    const w = await setupWorld();
    const stepId = insertChiefStep(w);
    expect(await claimAsCoordinator(w)).toBeNull();
    expect(statusOf(w, stepId).status).toBe('pending');
    expect((await claimAsDaemon(w))?.step.id).toBe(stepId);
  });

  test('flag on: daemons skip Coordinator turns and the sidecar claims them with the chief context', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    const stepId = insertChiefStep(w);
    expect(await claimAsDaemon(w)).toBeNull();
    const claimed = await claimAsCoordinator(w);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.chief?.systemPrompt).toEqual(expect.any(String));
    expect(claimed?.chief?.trigger).toBe('user');
    expect(claimed?.agent?.modelId).toBe('stub-model');
    expect(claimed?.instruction).toContain('status?');
    expect(statusOf(w, stepId)).toEqual({ status: 'claimed', machineId: w.sidecarId });
  });

  test('flag on: a restarted sidecar gets its claimed turn again; another machine never does', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    const stepId = insertChiefStep(w);
    expect((await claimAsCoordinator(w))?.step.id).toBe(stepId);
    expect((await claimAsCoordinator(w))?.step.id).toBe(stepId);
    expect(await claimAsDaemon(w)).toBeNull();
    expect(statusOf(w, stepId)).toEqual({ status: 'claimed', machineId: w.sidecarId });
  });

  test('flag on: turns of one thread go one at a time, oldest first', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    const first = insertChiefStep(w, { threadId: 'chief-coord-shared', createdAt: 10 });
    const second = insertChiefStep(w, { threadId: 'chief-coord-shared', createdAt: 20 });
    expect((await claimAsCoordinator(w))?.step.id).toBe(first);
    expect((await claimAsCoordinator(w))?.step.id).toBe(first);
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, first)).run();
    expect((await claimAsCoordinator(w))?.step.id).toBe(second);
  });

  test('flag on: digest steps stay with daemons', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    const digest = insertChiefStep(w, { threadId: chiefDigestThreadId(w.chiefId) });
    expect(await claimAsCoordinator(w)).toBeNull();
    expect((await claimAsDaemon(w))?.step.id).toBe(digest);
  });

  test('flag on: the sidecar is never handed worker steps or an empty queue', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    expect(await claimAsCoordinator(w)).toBeNull();
  });

  test('flag on: the sidecar reads the provider bundle for its own turn over the machine API', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    const stepId = insertChiefStep(w);
    await claimAsCoordinator(w);
    const res = await w.s.app.request(`/api/machine/token/${stepId}`, {
      headers: { authorization: `Bearer ${w.sidecarToken}` },
    });
    expect(res.status).toBe(200);
  });

  test('the claim route accepts the coordinator role', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    const stepId = insertChiefStep(w);
    const res = await w.s.app.request('/api/machine/tasks/claim', {
      method: 'POST',
      headers: { authorization: `Bearer ${w.sidecarToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'coordinator' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { step: { step: { id: string } } }).step.step.id).toBe(stepId);
  });

  test('flag on: another enrolled machine sending the coordinator role gets nothing', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    const stepId = insertChiefStep(w);
    expect(await claimAsCoordinator(w, w.daemonId)).toBeNull();
    expect(statusOf(w, stepId)).toEqual({ status: 'pending', machineId: null });
    await claimAsCoordinator(w);
    expect(await claimAsCoordinator(w, w.daemonId)).toBeNull();
  });

  test('flag on: a machine that does not hold a Coordinator step cannot read its provider key', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    const stepId = insertChiefStep(w);
    await claimAsCoordinator(w);
    const res = await w.s.app.request(`/api/machine/token/${stepId}`, {
      headers: { authorization: `Bearer ${w.daemonToken}` },
    });
    expect(res.status).toBe(404);
  });

  test('flag on: the sidecar does not take a Claude turn the team forbids paying for', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    w.s.db
      .update(agentTable)
      .set({ provider: 'anthropic', modelId: 'claude-haiku-5-5' })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    w.s.db
      .update(teamTable)
      .set({ claudeUsage: 'subscription-only' })
      .where(eq(teamTable.id, w.s.team.id))
      .run();
    const stepId = insertChiefStep(w);
    expect(await claimAsCoordinator(w)).toBeNull();
    w.s.db
      .update(teamTable)
      .set({ claudeUsage: 'allow-paid' })
      .where(eq(teamTable.id, w.s.team.id))
      .run();
    expect((await claimAsCoordinator(w))?.step.id).toBe(stepId);
  });

  test('flag on: the sidecar does not take a turn routed to the claude-code runtime', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    w.s.db
      .update(agentTable)
      .set({ provider: 'claude-code', modelId: 'haiku' })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    insertChiefStep(w);
    expect(await claimAsCoordinator(w)).toBeNull();
  });

  test('flag on, no keyed provider: a claude-code Coordinator stays with the daemon', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    bindClaudeCodeCoordinator(w);
    const stepId = insertChiefStep(w);
    expect(await claimAsCoordinator(w)).toBeNull();
    expect((await claimAsDaemon(w))?.step.id).toBe(stepId);
  });

  test('flag on, keyed provider but paid Claude not allowed: the route falls back and the daemon runs the turn', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    bindClaudeCodeCoordinator(w);
    addKeyedAnthropicProvider(w);
    setClaudeUsage(w, 'subscription-only');
    const stepId = insertChiefStep(w);
    expect(await claimAsCoordinator(w)).toBeNull();
    expect((await claimAsDaemon(w))?.step.id).toBe(stepId);
  });

  test('flag on, keyed provider and paid Claude allowed: the sidecar runs the turn and the daemon skips it', async () => {
    const w = await setupWorld();
    setCoordinatorMachineId(w.sidecarId);
    bindClaudeCodeCoordinator(w);
    addKeyedAnthropicProvider(w);
    setClaudeUsage(w, 'allow-paid');
    const stepId = insertChiefStep(w);
    expect(await claimAsDaemon(w)).toBeNull();
    const claimed = await claimAsCoordinator(w);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.agent).toMatchObject({
      provider: 'anthropic-byok',
      modelId: 'claude-haiku-5-5',
    });
  });

  test('the claim route rejects an unknown role', async () => {
    const w = await setupWorld();
    const res = await w.s.app.request('/api/machine/tasks/claim', {
      method: 'POST',
      headers: { authorization: `Bearer ${w.sidecarToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(400);
  });
});
