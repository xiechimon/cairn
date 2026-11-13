import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  machine as machineTable,
  project as projectTable,
  routingRule,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { startBuilds } from '../src/services/builds.js';
import { claimStep } from '../src/services/machines.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import { bootServer, issueApiKey, postProject, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

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
    body: JSON.stringify(
      readyMachine({
        teamId: w.s.team.id,
        name,
        cliVersion: '0.1.0',
        capabilities: { mcpServers: [], skills: [], executor: opts.executor ?? 'host' },
      }),
    ),
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

function routeOf(
  w: World,
  preferred: string | null,
  requiredCapabilities: { executor?: 'orb' } | null = null,
): void {
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
  const filler = pendingStep(w);
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

describe('a worker step runs only on its named machine', () => {
  test('preferred machine offline: another eligible machine does not take the step', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    const mac = await machineOf(w, 'mac');
    routeOf(w, omarchy);
    const stepId = pendingStep(w);
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
  });

  test('preferred machine online and free: another machine leaves the step to it', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy');
    const mac = await machineOf(w, 'mac');
    routeOf(w, omarchy);
    const stepId = pendingStep(w);
    expect(await claimOn(w, mac)).toBeNull();
    expect((await claimOn(w, omarchy))?.step.id).toBe(stepId);
  });

  test('preferred machine only busy: another machine never takes the step', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { maxConcurrent: 1 });
    const mac = await machineOf(w, 'mac');
    routeOf(w, omarchy);
    occupy(w, omarchy, 1);
    const stepId = pendingStep(w, { ageMs: 60 * 60_000 });
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
  });

  test('preferred machine missing the runtime: another machine does not take it', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { runtimes: [] });
    const mac = await machineOf(w, 'mac');
    routeOf(w, omarchy);
    const stepId = pendingStep(w);
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
  });

  test('no preferred machine and one machine: that machine takes it', async () => {
    const w = await world();
    const mac = await machineOf(w, 'mac');
    routeOf(w, null);
    const stepId = pendingStep(w);
    expect((await claimOn(w, mac))?.step.id).toBe(stepId);
  });

  test('an Orb-required route waits for an Orb executor and never falls back to a host', async () => {
    const w = await world();
    const orb = await machineOf(w, 'omarchy-orb', { online: false, executor: 'orb' });
    const mac = await machineOf(w, 'mac');
    routeOf(w, orb, { executor: 'orb' });
    const stepId = pendingStep(w, { ageMs: 60 * 60_000 });
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
  });

  test('an Orb-required route does not move to another Orb executor when its preferred one is offline', async () => {
    const w = await world();
    const orb = await machineOf(w, 'omarchy-orb', { online: false, executor: 'orb' });
    const macOrb = await machineOf(w, 'mac-orb', { executor: 'orb' });
    routeOf(w, orb, { executor: 'orb' });
    const stepId = pendingStep(w);
    expect(await claimOn(w, macOrb)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
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
    routeOf(w, omarchy);
    const stepId = pendingStep(w, { ageMs: 60 * 60_000 });
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
  });

  test('a session step stays on its offline session machine and does not hop', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    const mac = await machineOf(w, 'mac');
    routeOf(w, omarchy);
    const stepId = pendingStep(w, {
      ageMs: 60 * 60_000,
      priorSession: { machineId: omarchy, sessionId: 'sess-late' },
    });
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
  });

  test('a session step goes back to its session machine before the preferred machine', async () => {
    const w = await world();
    const mac = await machineOf(w, 'mac');
    const omarchy = await machineOf(w, 'omarchy');
    routeOf(w, omarchy);
    const stepId = pendingStep(w, {
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
    routeOf(w, omarchy);
    occupy(w, omarchy, 1);
    const stepId = pendingStep(w);
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    const queue = stepQueueProjector(w.s.db, w.s.team.id).project({
      id: stepId,
      createdAt: row.createdAt,
      homeMachineId: omarchy,
    });
    expect(queue?.waitingFor?.machineId).toBe(omarchy);
    expect(queue?.waitingFor).not.toHaveProperty('fallbackAt');
  });

  test('two machines racing for an unnamed step: neither wins', async () => {
    const w = await world();
    const a = await machineOf(w, 'a');
    const b = await machineOf(w, 'b');
    routeOf(w, null);
    const stepId = pendingStep(w);
    const [ra, rb] = await Promise.all([claimOn(w, a), claimOn(w, b)]);
    expect(ra).toBeNull();
    expect(rb).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
  });

  test('the only online machine claims an unnamed step while another machine is offline', async () => {
    const w = await world();
    const online = await machineOf(w, 'online');
    await machineOf(w, 'offline', { online: false });
    routeOf(w, null);
    const stepId = pendingStep(w);
    const claimed = await claimOn(w, online);
    expect(claimed?.step.id).toBe(stepId);
  });

  test('one registered machine is the queue target when the step has no pin', async () => {
    const w = await world();
    const only = await machineOf(w, 'only');
    routeOf(w, null);
    const stepId = pendingStep(w);
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    const queue = stepQueueProjector(w.s.db, w.s.team.id).project({
      id: stepId,
      createdAt: row.createdAt,
      homeMachineId: null,
    });
    expect(queue?.waitingFor?.machineId).toBe(only);
    expect(queue?.blocked).toBeUndefined();
  });

  test('the queue keeps waiting for the named machine when it is offline', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    const mac = await machineOf(w, 'mac', { maxConcurrent: 1 });
    routeOf(w, omarchy);
    occupy(w, mac, 1);
    const stepId = pendingStep(w);
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    const queue = stepQueueProjector(w.s.db, w.s.team.id).project({
      id: stepId,
      createdAt: row.createdAt,
      homeMachineId: omarchy,
    });
    expect(queue?.waitingFor?.machineId).toBe(omarchy);
    expect(queue?.blocked).toEqual({ kind: 'machine-offline', missing: [] });
  });

  test('a thread override cannot drop the rule Orb requirement, even by sending empty constraints', async () => {
    const w = await world();
    const orb = await machineOf(w, 'omarchy-orb', { online: false, executor: 'orb' });
    const mac = await machineOf(w, 'mac');
    routeOf(w, orb, { executor: 'orb' });
    const stepId = pendingStep(w);
    setOverride(w, stepId, { machineId: mac, requiredCapabilities: {} });
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
  });

  test('a thread override moves the preference to another machine', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy');
    const mac = await machineOf(w, 'mac');
    routeOf(w, omarchy);
    const stepId = pendingStep(w);
    setOverride(w, stepId, { machineId: mac });
    expect(await claimOn(w, omarchy)).toBeNull();
    expect((await claimOn(w, mac))?.step.id).toBe(stepId);
  });

  test('a thread override adds a constraint the rule did not have', async () => {
    const w = await world();
    const mac = await machineOf(w, 'mac');
    await machineOf(w, 'mac-orb', { executor: 'orb', online: false });
    routeOf(w, mac);
    const stepId = pendingStep(w);
    setOverride(w, stepId, { requiredCapabilities: { executor: 'orb' } });
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
  });

  test('two online machines and no name: start is refused; one online machine is pinned', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy');
    const mac = await machineOf(w, 'mac');
    routeOf(w, null);
    const todoId = `todo-start-${++seq}`;
    w.s.db
      .insert(todoTable)
      .values({
        id: todoId,
        teamId: w.s.team.id,
        projectId: w.projectId,
        seqNum: seq,
        title: 'start',
        spec: 'probe',
        phase: 'todo',
        phaseAt: Date.now(),
      })
      .run();
    expect(() => startBuilds(w.s.svc, { projectId: w.projectId, todoIds: [todoId] })).toThrow(
      /Name a machine/,
    );
    w.s.db.update(machineTable).set({ online: false }).where(eq(machineTable.id, mac)).run();
    startBuilds(w.s.svc, { projectId: w.projectId, todoIds: [todoId] });
    expect(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.routeOverride,
    ).toEqual({
      machineId: omarchy,
    });
  });
});

function setOverride(
  w: World,
  stepId: string,
  routeOverride: { machineId?: string; requiredCapabilities?: { executor?: 'orb' } },
): void {
  const buildId = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.buildId;
  const todoId = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!.todoId;
  w.s.db.update(todoTable).set({ routeOverride }).where(eq(todoTable.id, todoId)).run();
}
