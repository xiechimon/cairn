import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  project as projectTable,
  routingRule,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { OVERFLOW_AFTER_MS, SESSION_GRACE_MS } from '../src/services/machine-routing.js';
import { claimStep } from '../src/services/machines.js';
import { setRoutingRulesEnabled } from '../src/services/routing-rules.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import { bootServer, issueApiKey, postProject, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});
beforeEach(() => setRoutingRulesEnabled(true));
afterEach(() => setRoutingRulesEnabled(false));

let seq = 20_000;

interface World {
  s: TestServer;
  projectId: string;
}

async function world(): Promise<World> {
  const s = bootServer({ claimHoldMs: 50 });
  disposables.push(() => s.dispose());
  return { s, projectId: await postProject(s.app, 'pool-proj') };
}

async function machineOf(
  w: World,
  name: string,
  opts: {
    online?: boolean;
    executor?: 'orb' | 'host';
    runtimes?: string[];
    maxConcurrent?: number;
  } = {},
): Promise<string> {
  const apiKey = await issueApiKey(w.s);
  const res = await w.s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId: w.s.team.id,
      name,
      cliVersion: '0.1.0',
      capabilities: { mcpServers: [], skills: [], executor: opts.executor ?? 'host' },
    }),
  });
  expect(res.status).toBe(200);
  const { machineId } = (await res.json()) as { machineId: string };
  w.s.db
    .update(machineTable)
    .set({
      online: opts.online ?? true,
      enabledRuntimes: opts.runtimes ?? ['pi'],
      maxConcurrent: opts.maxConcurrent ?? 3,
    })
    .where(eq(machineTable.id, machineId))
    .run();
  return machineId;
}

function agentOf(
  w: World,
  id: string,
  preferred: string | null,
  requiredCapabilities: { executor?: 'orb' } | null = null,
): void {
  w.s.db
    .insert(agentTable)
    .values({
      id,
      teamId: w.s.team.id,
      displayName: id,
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
      requiredCapabilities: null,
      machineId: null,
    })
    .run();
  w.s.db.delete(routingRule).where(eq(routingRule.teamId, w.s.team.id)).run();
  w.s.db
    .insert(routingRule)
    .values({
      id: newRecordId(),
      teamId: w.s.team.id,
      use: 'session',
      provider: 'stub-gw',
      modelId: 'stub-model',
      thinkingLevel: null,
      machineId: preferred,
      requiredCapabilities,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
}

function pendingStep(
  w: World,
  agentId: string,
  opts: { ageMs?: number; priorSession?: { machineId: string; sessionId: string } } = {},
): string {
  seq += 1;
  const id = `pool-${seq}`;
  const now = Date.now();
  const createdAt = now - (opts.ageMs ?? 0);
  w.s.db
    .insert(todoTable)
    .values({
      id: `todo-${id}`,
      teamId: w.s.team.id,
      projectId: w.projectId,
      seqNum: seq,
      title: `pool ${id}`,
      spec: 'probe',
      phase: 'queued',
      phaseAt: createdAt,
      assignment: { plan: null, build: { agentId } },
    })
    .run();
  w.s.db
    .insert(buildTable)
    .values({
      id: `build-${id}`,
      todoId: `todo-${id}`,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: createdAt - 10,
    })
    .run();
  if (opts.priorSession !== undefined) {
    w.s.db
      .insert(stepTable)
      .values({
        id: `prior-${id}`,
        buildId: `build-${id}`,
        kind: 'build',
        machineId: opts.priorSession.machineId,
        status: 'done',
        prompt: null,
        freshSession: false,
        sessionId: opts.priorSession.sessionId,
        createdAt: createdAt - 5,
      })
      .run();
  }
  w.s.db
    .insert(stepTable)
    .values({
      id: `step-${id}`,
      buildId: `build-${id}`,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt,
    })
    .run();
  return `step-${id}`;
}

function claimOn(w: World, machineId: string) {
  return claimStep(
    {
      ...w.s.svc,
      box: w.s.secretBox,
      reposDir: w.s.reposDir,
      attachmentsDir: w.s.attachmentsDir,
      skillsDir: w.s.skillsDir,
    },
    machineId,
    w.s.team.id,
    10,
    'http://localhost',
  );
}

function statusOf(w: World, stepId: string): string {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status;
}

function occupy(w: World, machineId: string, n: number): void {
  const filler = pendingStep(w, 'agent-filler-none');
  for (let i = 0; i < n; i++) {
    w.s.db
      .insert(stepTable)
      .values({
        id: `busy-${machineId}-${i}`,
        buildId: w.s.db.select().from(stepTable).where(eq(stepTable.id, filler)).get()!.buildId,
        kind: 'build',
        machineId,
        status: 'claimed',
        prompt: null,
        freshSession: false,
        createdAt: Date.now(),
      })
      .run();
  }
  w.s.db.delete(stepTable).where(eq(stepTable.id, filler)).run();
}

describe('D71 worker steps route by a capability pool plus a preferred machine', () => {
  test('preferred machine offline: another eligible machine takes a step without a session at once', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    const mac = await machineOf(w, 'mac');
    agentOf(w, 'reviewer', omarchy);
    const stepId = pendingStep(w, 'reviewer');
    expect((await claimOn(w, mac))?.step.id).toBe(stepId);
  });

  test('preferred machine online and free: another machine leaves the step to it', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy');
    const mac = await machineOf(w, 'mac');
    agentOf(w, 'reviewer', omarchy);
    const stepId = pendingStep(w, 'reviewer');
    expect(await claimOn(w, mac)).toBeNull();
    expect((await claimOn(w, omarchy))?.step.id).toBe(stepId);
  });

  test('preferred machine only busy: another machine overflows after 10 minutes, not before', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { maxConcurrent: 1 });
    const mac = await machineOf(w, 'mac');
    agentOf(w, 'builder', omarchy);
    occupy(w, omarchy, 1);
    const fresh = pendingStep(w, 'builder', { ageMs: OVERFLOW_AFTER_MS - 60_000 });
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, fresh)).toBe('pending');
    const old = pendingStep(w, 'builder', { ageMs: OVERFLOW_AFTER_MS + 1_000 });
    expect((await claimOn(w, mac))?.step.id).toBe(old);
  });

  test('preferred machine missing the runtime: another machine takes it at once', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { runtimes: [] });
    const mac = await machineOf(w, 'mac');
    agentOf(w, 'reviewer', omarchy);
    const stepId = pendingStep(w, 'reviewer');
    expect((await claimOn(w, mac))?.step.id).toBe(stepId);
  });

  test('no preferred machine: any eligible machine takes it', async () => {
    const w = await world();
    const mac = await machineOf(w, 'mac');
    agentOf(w, 'floating', null);
    const stepId = pendingStep(w, 'floating');
    expect((await claimOn(w, mac))?.step.id).toBe(stepId);
  });

  test('an Orb-required agent waits for an Orb executor and never falls back to a host', async () => {
    const w = await world();
    const orb = await machineOf(w, 'omarchy-orb', { online: false, executor: 'orb' });
    const mac = await machineOf(w, 'mac');
    agentOf(w, 'implementer', orb, { executor: 'orb' });
    const stepId = pendingStep(w, 'implementer', { ageMs: OVERFLOW_AFTER_MS * 6 });
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
  });

  test('an Orb-required agent may move to another Orb executor when its preferred one is offline', async () => {
    const w = await world();
    const orb = await machineOf(w, 'omarchy-orb', { online: false, executor: 'orb' });
    const macOrb = await machineOf(w, 'mac-orb', { executor: 'orb' });
    agentOf(w, 'implementer', orb, { executor: 'orb' });
    const stepId = pendingStep(w, 'implementer');
    expect((await claimOn(w, macOrb))?.step.id).toBe(stepId);
  });

  test('a local-path project never leaves its preferred machine', async () => {
    const w = await world();
    w.s.db
      .update(projectTable)
      .set({ repoKind: 'local', localPath: '/srv/repo' })
      .where(eq(projectTable.id, w.projectId))
      .run();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    const mac = await machineOf(w, 'mac');
    agentOf(w, 'builder', omarchy);
    const stepId = pendingStep(w, 'builder', { ageMs: OVERFLOW_AFTER_MS * 2 });
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
  });

  test('a session step waits 5 minutes for its offline session machine, then hops with the hand-off note', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    const mac = await machineOf(w, 'mac');
    agentOf(w, 'builder', omarchy);
    const early = pendingStep(w, 'builder', {
      ageMs: SESSION_GRACE_MS - 60_000,
      priorSession: { machineId: omarchy, sessionId: 'sess-early' },
    });
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, early)).toBe('pending');
    const late = pendingStep(w, 'builder', {
      ageMs: SESSION_GRACE_MS + 1_000,
      priorSession: { machineId: omarchy, sessionId: 'sess-late' },
    });
    const claimed = await claimOn(w, mac);
    expect(claimed?.step.id).toBe(late);
    expect(claimed?.session).toEqual({
      action: 'continue',
      sessionId: 'sess-late',
      priorMachineId: omarchy,
    });
  });

  test('a session step goes back to its session machine before the preferred machine', async () => {
    const w = await world();
    const mac = await machineOf(w, 'mac');
    const omarchy = await machineOf(w, 'omarchy');
    agentOf(w, 'builder', omarchy);
    const stepId = pendingStep(w, 'builder', {
      priorSession: { machineId: mac, sessionId: 'sess-mac' },
    });
    expect(await claimOn(w, omarchy)).toBeNull();
    const claimed = await claimOn(w, mac);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.session).toEqual({ action: 'continue', sessionId: 'sess-mac' });
  });

  test('the queue names the preferred machine and the moment the step may fall back', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { maxConcurrent: 1 });
    agentOf(w, 'builder', omarchy);
    occupy(w, omarchy, 1);
    const stepId = pendingStep(w, 'builder');
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    const queue = stepQueueProjector(w.s.db, w.s.team.id).project({
      id: stepId,
      createdAt: row.createdAt,
      homeMachineId: omarchy,
    });
    expect(queue?.waitingFor?.machineId).toBe(omarchy);
    expect(queue?.waitingFor?.fallbackAt).toBe(row.createdAt + OVERFLOW_AFTER_MS);
  });

  test('two machines racing for one pooled step: exactly one wins', async () => {
    const w = await world();
    const a = await machineOf(w, 'a');
    const b = await machineOf(w, 'b');
    agentOf(w, 'floating', null);
    const stepId = pendingStep(w, 'floating');
    const [ra, rb] = await Promise.all([claimOn(w, a), claimOn(w, b)]);
    expect([ra?.step.id, rb?.step.id].filter((id) => id === stepId)).toHaveLength(1);
  });

  test('routing rules off: the agent pin holds and an offline pinned machine keeps its step', async () => {
    const w = await world();
    setRoutingRulesEnabled(false);
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    const mac = await machineOf(w, 'mac');
    agentOf(w, 'pinned', null);
    w.s.db.update(agentTable).set({ machineId: omarchy }).where(eq(agentTable.id, 'pinned')).run();
    const stepId = pendingStep(w, 'pinned', { ageMs: OVERFLOW_AFTER_MS * 2 });
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
  });

  test('routing rules off: a spare still takes over from a rate-blocked pinned machine without a model report (no new gates)', async () => {
    const w = await world();
    setRoutingRulesEnabled(false);
    const omarchy = await machineOf(w, 'omarchy', { runtimes: ['claude-code'] });
    const spare = await machineOf(w, 'spare', { runtimes: ['claude-code'] });
    w.s.db
      .update(machineTable)
      .set({
        claudeRateLimits: [
          {
            subscription: 'five_hour',
            status: 'rejected',
            utilization: 1,
            resetsAt: Date.now() + 3_600_000,
            reportedAt: Date.now(),
          },
        ],
      })
      .where(eq(machineTable.id, omarchy))
      .run();
    agentOf(w, 'cc', null);
    w.s.db
      .update(agentTable)
      .set({ machineId: omarchy, provider: 'claude-code' })
      .where(eq(agentTable.id, 'cc'))
      .run();
    w.s.db.update(teamTable).set({ claudeUsage: 'allow-paid' }).run();
    const stepId = pendingStep(w, 'cc');
    expect((await claimOn(w, spare))?.step.id).toBe(stepId);
  });

  test('the queue waits for any free machine once the route has released the step', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    const mac = await machineOf(w, 'mac', { maxConcurrent: 1 });
    agentOf(w, 'reviewer', omarchy);
    occupy(w, mac, 1);
    const stepId = pendingStep(w, 'reviewer');
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    const queue = stepQueueProjector(w.s.db, w.s.team.id).project({
      id: stepId,
      createdAt: row.createdAt,
      homeMachineId: omarchy,
    });
    expect(queue?.waitingFor).toBeNull();
    expect(queue?.blocked).toBeUndefined();
  });
});
