import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  machine as machineTable,
  project as projectTable,
  routingRule,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { startBuilds } from '../src/services/builds.js';
import { claimStep } from '../src/services/machines.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import { toTodoRecord } from '../src/services/todos.js';
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
    osPlatform?: 'linux' | 'darwin' | 'windows';
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
  const enrolled = w.s.db.select().from(machineTable).where(eq(machineTable.id, machineId)).get();
  w.s.db
    .update(machineTable)
    .set({
      ...(opts.osPlatform !== undefined && enrolled?.capabilities
        ? { capabilities: { ...enrolled.capabilities, osPlatform: opts.osPlatform } }
        : {}),
      online: opts.online ?? true,
      enabledRuntimes: opts.runtimes ?? ['pi'],
      maxConcurrent: opts.maxConcurrent ?? 3,
    })
    .where(eq(machineTable.id, machineId))
    .run();
  return machineId;
}

function setDefault(w: World, machineId: string | null): void {
  w.s.db
    .update(teamTable)
    .set({ defaultMachineId: machineId })
    .where(eq(teamTable.id, w.s.team.id))
    .run();
}

function defaultOf(w: World): string | null {
  return (
    w.s.db.select().from(teamTable).where(eq(teamTable.id, w.s.team.id)).get()?.defaultMachineId ??
    null
  );
}

function queuedTodo(w: World): string {
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
  return todoId;
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

  test('two machines racing for an unnamed step with no default Runner: neither wins', async () => {
    const w = await world();
    const a = await machineOf(w, 'a');
    const b = await machineOf(w, 'b');
    setDefault(w, null);
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

  test('two online machines, no name and no default Runner: start is refused; one online machine is pinned', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy');
    const mac = await machineOf(w, 'mac');
    setDefault(w, null);
    routeOf(w, null);
    const todoId = queuedTodo(w);
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
  routeOverride: {
    machineId?: string;
    requiredCapabilities?: { executor?: 'orb'; os?: 'linux' | 'macos' | 'windows' };
  },
): void {
  const buildId = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.buildId;
  const todoId = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!.todoId;
  w.s.db.update(todoTable).set({ routeOverride }).where(eq(todoTable.id, todoId)).run();
}

describe('the default Runner', () => {
  test('the first enrolled machine becomes the default; later ones do not', async () => {
    const w = await world();
    const linux = await machineOf(w, 'linux');
    await machineOf(w, 'mac');
    expect(defaultOf(w)).toBe(linux);
  });

  test('an unnamed step goes to the default Runner, not to another online machine', async () => {
    const w = await world();
    const linux = await machineOf(w, 'linux');
    const mac = await machineOf(w, 'mac');
    routeOf(w, null);
    const stepId = pendingStep(w);
    expect(await claimOn(w, mac)).toBeNull();
    expect((await claimOn(w, linux))?.step.id).toBe(stepId);
  });

  test('an offline default Runner keeps the step waiting; no other machine takes it', async () => {
    const w = await world();
    const linux = await machineOf(w, 'linux', { online: false });
    const mac = await machineOf(w, 'mac');
    routeOf(w, null);
    const stepId = pendingStep(w, { ageMs: 60 * 60_000 });
    expect(await claimOn(w, mac)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    const queue = stepQueueProjector(w.s.db, w.s.team.id).project({
      id: stepId,
      createdAt: row.createdAt,
      homeMachineId: null,
    });
    expect(queue?.waitingFor?.machineId).toBe(linux);
    expect(queue?.blocked).toEqual({ kind: 'machine-offline', missing: [] });
    const todoId = w.s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, row.buildId))
      .get()!.todoId;
    w.s.db
      .update(todoTable)
      .set({ latestBuildId: row.buildId })
      .where(eq(todoTable.id, todoId))
      .run();
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
    expect(toTodoRecord(w.s.svc, todoRow).waitingOn).toEqual({ on: 'machine', retryAt: null });
  });

  test('a rule machine and a task pick both outrank the default Runner', async () => {
    const w = await world();
    const linux = await machineOf(w, 'linux');
    const mac = await machineOf(w, 'mac');
    const win = await machineOf(w, 'win');
    routeOf(w, mac);
    const ruled = pendingStep(w);
    expect(await claimOn(w, linux)).toBeNull();
    expect((await claimOn(w, mac))?.step.id).toBe(ruled);
    const picked = pendingStep(w);
    setOverride(w, picked, { machineId: win });
    expect(await claimOn(w, linux)).toBeNull();
    expect((await claimOn(w, win))?.step.id).toBe(picked);
  });

  test('with a default Runner, start succeeds and does not pin the task', async () => {
    const w = await world();
    const linux = await machineOf(w, 'linux');
    await machineOf(w, 'mac');
    routeOf(w, null);
    expect(defaultOf(w)).toBe(linux);
    const todoId = queuedTodo(w);
    startBuilds(w.s.svc, { projectId: w.projectId, todoIds: [todoId] });
    expect(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.routeOverride ?? null,
    ).toBeNull();
  });

  test('revoking or deleting the default Runner clears it, and a later enroll does not take it over', async () => {
    const w = await world();
    const linux = await machineOf(w, 'linux');
    const mac = await machineOf(w, 'mac');
    expect(
      (await w.s.app.request(`/api/machines/${linux}/revoke`, { method: 'POST' })).status,
    ).toBe(204);
    expect(defaultOf(w)).toBeNull();
    await machineOf(w, 'late');
    expect(defaultOf(w)).toBeNull();
    setDefault(w, mac);
    expect((await w.s.app.request(`/api/machines/${mac}`, { method: 'DELETE' })).status).toBe(204);
    expect(defaultOf(w)).toBeNull();
  });
});

function queueOf(w: World, stepId: string) {
  const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
  return stepQueueProjector(w.s.db, w.s.team.id).project({
    id: stepId,
    createdAt: row.createdAt,
    homeMachineId: null,
  });
}

function macTask(w: World, os: 'macos' | 'windows' = 'macos'): string {
  const stepId = pendingStep(w);
  setOverride(w, stepId, { requiredCapabilities: { os } });
  return stepId;
}

describe('a task that needs a platform', () => {
  test('a macOS task skips the Linux default and runs on the Mac', async () => {
    const w = await world();
    const linux = await machineOf(w, 'linux', { osPlatform: 'linux' });
    const mac = await machineOf(w, 'mac', { osPlatform: 'darwin' });
    routeOf(w, null);
    expect(defaultOf(w)).toBe(linux);
    const stepId = macTask(w);
    expect(await claimOn(w, linux)).toBeNull();
    expect((await claimOn(w, mac))?.step.id).toBe(stepId);
  });

  test('a rule machine on Linux does not hold a macOS task', async () => {
    const w = await world();
    const linux = await machineOf(w, 'linux', { osPlatform: 'linux' });
    const mac = await machineOf(w, 'mac', { osPlatform: 'darwin' });
    routeOf(w, linux);
    const stepId = macTask(w);
    expect(queueOf(w, stepId)?.waitingFor?.machineId).not.toBe(linux);
    expect((await claimOn(w, mac))?.step.id).toBe(stepId);
  });

  test('a default Runner that matches the platform keeps the task', async () => {
    const w = await world();
    const first = await machineOf(w, 'mac-a', { osPlatform: 'darwin' });
    const second = await machineOf(w, 'mac-b', { osPlatform: 'darwin' });
    setDefault(w, second);
    occupy(w, second, 2);
    routeOf(w, null);
    const stepId = macTask(w);
    expect(await claimOn(w, first)).toBeNull();
    expect((await claimOn(w, second))?.step.id).toBe(stepId);
  });

  test('without a matching default, the Mac running the fewest tasks takes it', async () => {
    const w = await world();
    await machineOf(w, 'linux', { osPlatform: 'linux' });
    const busy = await machineOf(w, 'mac-busy', { osPlatform: 'darwin' });
    const idle = await machineOf(w, 'mac-idle', { osPlatform: 'darwin' });
    occupy(w, busy, 2);
    routeOf(w, null);
    const stepId = macTask(w);
    expect(await claimOn(w, busy)).toBeNull();
    expect((await claimOn(w, idle))?.step.id).toBe(stepId);
  });

  test('an offline Mac keeps the macOS task waiting for it; Linux does not take it', async () => {
    const w = await world();
    const linux = await machineOf(w, 'linux', { osPlatform: 'linux' });
    const mac = await machineOf(w, 'mac', { osPlatform: 'darwin', online: false });
    routeOf(w, null);
    const stepId = macTask(w);
    expect(await claimOn(w, linux)).toBeNull();
    expect(statusOf(w, stepId)).toBe('pending');
    const queue = queueOf(w, stepId);
    expect(queue?.waitingFor?.machineId).toBe(mac);
    expect(queue?.blocked).toEqual({ kind: 'machine-offline', missing: [], platform: 'macos' });
  });

  test('with no Windows Runner the task says Windows is missing and nobody claims it', async () => {
    const w = await world();
    const linux = await machineOf(w, 'linux', { osPlatform: 'linux' });
    const mac = await machineOf(w, 'mac', { osPlatform: 'darwin' });
    routeOf(w, null);
    const stepId = macTask(w, 'windows');
    expect(await claimOn(w, linux)).toBeNull();
    expect(await claimOn(w, mac)).toBeNull();
    const queue = queueOf(w, stepId);
    expect(queue?.waitingFor ?? null).toBeNull();
    expect(queue?.blocked).toEqual({
      kind: 'capability-missing',
      missing: ['Windows'],
      platform: 'windows',
    });
  });

  test('a daemon that does not report its OS cannot take a macOS task', async () => {
    const w = await world();
    const unknown = await machineOf(w, 'old-nas');
    routeOf(w, null);
    const stepId = macTask(w);
    expect(await claimOn(w, unknown)).toBeNull();
    expect(queueOf(w, stepId)?.blocked).toEqual({
      kind: 'capability-missing',
      missing: ['macOS'],
      platform: 'macos',
    });
  });

  test('moving a macOS task onto a Linux Runner is refused', async () => {
    const w = await world();
    const linux = await machineOf(w, 'linux', { osPlatform: 'linux' });
    await machineOf(w, 'mac', { osPlatform: 'darwin', online: false });
    routeOf(w, null);
    const todoId = todoOfStep(w, macTask(w));
    const res = await w.s.app.request(`/api/todos/${todoId}/runner`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineId: linux }),
    });
    expect(res.status).toBe(409);
    expect(routeOverrideOf(w, todoId)).toEqual({ requiredCapabilities: { os: 'macos' } });
  });

  test('the platform can change before the task starts and is locked once a session exists', async () => {
    const w = await world();
    const linux = await machineOf(w, 'linux', { osPlatform: 'linux' });
    routeOf(w, null);
    const patch = (todoId: string, os: 'macos' | 'windows') =>
      w.s.app.request(`/api/todos/${todoId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ routeOverride: { requiredCapabilities: { os } } }),
      });
    const fresh = todoOfStep(w, pendingStep(w));
    expect((await patch(fresh, 'macos')).status).toBe(200);
    expect(routeOverrideOf(w, fresh)).toEqual({ requiredCapabilities: { os: 'macos' } });
    const started = todoOfStep(
      w,
      pendingStep(w, { priorSession: { machineId: linux, sessionId: 'sess-1' } }),
    );
    const locked = await patch(started, 'windows');
    expect(locked.status).toBe(409);
    expect(await locked.text()).toContain('运行中不能改');
    expect(routeOverrideOf(w, started)).toBeNull();
  });
});

function todoOfStep(w: World, stepId: string): string {
  const buildId = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.buildId;
  return w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!.todoId;
}

function routeOverrideOf(w: World, todoId: string) {
  return (
    w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.routeOverride ?? null
  );
}
