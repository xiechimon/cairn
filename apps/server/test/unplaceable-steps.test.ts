import type { RunnerOfflineContent } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  chiefMessage,
  machine as machineTable,
  notification as notificationTable,
  project as projectTable,
  routingRule,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { RUNNER_OFFLINE_NOTICE_MS, sweepOfflineRunners } from '../src/services/runner-offline.js';
import { NO_MACHINE_ALERT_MS, sweepUnplaceableSteps } from '../src/services/unplaceable-steps.js';
import { bootServer, issueApiKey, postProject, req, type TestServer } from './helpers.js';

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

function routeOf(
  w: World,
  preferred: string | null,
  requiredCapabilities: { executor?: 'orb'; mcpServers?: string[] } | null = null,
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

function alerts(w: World) {
  return w.s.db
    .select()
    .from(notificationTable)
    .all()
    .filter((n) => n.type === 'no_machine');
}

describe('D71 a pending step that no online machine can run raises one inbox item', () => {
  test('no alert before the wait has passed', async () => {
    const w = await world();
    const orb = await machineOf(w, 'omarchy-orb', { online: false, executor: 'orb' });
    await machineOf(w, 'mac');
    routeOf(w, orb, { executor: 'orb' });
    pendingStep(w, { ageMs: NO_MACHINE_ALERT_MS - 60_000 });
    sweepUnplaceableSteps(w.s.svc, Date.now());
    expect(alerts(w)).toHaveLength(0);
  });

  test('an offline routed Runner leaves the inbox to the Coordinator notice', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    await machineOf(w, 'mac');
    routeOf(w, omarchy);
    pendingStep(w, { ageMs: NO_MACHINE_ALERT_MS + 1_000 });
    sweepUnplaceableSteps(w.s.svc, Date.now());
    expect(alerts(w)).toHaveLength(0);
  });

  test('a missing capability on the online machines is named', async () => {
    const w = await world();
    const mac = await machineOf(w, 'mac');
    routeOf(w, mac, { mcpServers: ['figma'] });
    pendingStep(w, { ageMs: NO_MACHINE_ALERT_MS + 1_000 });
    sweepUnplaceableSteps(w.s.svc, Date.now());
    expect(alerts(w)[0]?.snippet).toContain('MCP server "figma"');
  });

  test('a read alert is not raised again for the same wait', async () => {
    const w = await world();
    const mac = await machineOf(w, 'mac');
    routeOf(w, mac, { mcpServers: ['figma'] });
    pendingStep(w, { ageMs: NO_MACHINE_ALERT_MS + 1_000 });
    sweepUnplaceableSteps(w.s.svc, Date.now());
    w.s.db.update(notificationTable).set({ readAt: Date.now() }).run();
    sweepUnplaceableSteps(w.s.svc, Date.now() + 60_000);
    expect(alerts(w)).toHaveLength(1);
    expect(alerts(w)[0]?.readAt).not.toBeNull();
  });
});

function lastSeen(w: World, machineId: string, at: number, online = false): void {
  w.s.db
    .update(machineTable)
    .set({ online, lastSeenAt: at })
    .where(eq(machineTable.id, machineId))
    .run();
}

function notices(w: World) {
  return w.s.db
    .select()
    .from(chiefMessage)
    .all()
    .filter((row) => row.id.startsWith('runner-offline-'))
    .map((row) => ({ id: row.id, ...(JSON.parse(String(row.content)) as Record<string, unknown>) }))
    .map((row) => row as unknown as RunnerOfflineContent & { id: string });
}

function claim(w: World, stepId: string, machineId: string, at: number): void {
  w.s.db
    .update(stepTable)
    .set({ status: 'claimed', machineId, claimedAt: at })
    .where(eq(stepTable.id, stepId))
    .run();
}

describe('an offline Runner with waiting tasks raises one Coordinator notice per offline period', () => {
  test('a Runner back within two minutes raises no notice', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    routeOf(w, omarchy);
    pendingStep(w);
    const now = Date.now();
    lastSeen(w, omarchy, now - RUNNER_OFFLINE_NOTICE_MS + 30_000);
    sweepOfflineRunners(w.s.svc, now);
    expect(notices(w)).toHaveLength(0);
  });

  test('ten waiting tasks on one offline Runner raise one notice listing all ten', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    routeOf(w, omarchy);
    for (let i = 0; i < 10; i++) pendingStep(w);
    const now = Date.now();
    lastSeen(w, omarchy, now - RUNNER_OFFLINE_NOTICE_MS - 1_000);
    sweepOfflineRunners(w.s.svc, now);
    sweepOfflineRunners(w.s.svc, now + 60_000);
    const [notice, extra] = notices(w);
    expect(extra).toBeUndefined();
    expect(notice?.machineName).toBe('omarchy');
    expect(notice?.todos.filter((t) => t.state === 'waiting')).toHaveLength(10);
  });

  test('a return marks waiting tasks started, and a second offline period gets a new notice', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    routeOf(w, omarchy);
    const first = pendingStep(w);
    pendingStep(w);
    const t0 = Date.now();
    lastSeen(w, omarchy, t0 - RUNNER_OFFLINE_NOTICE_MS - 1_000);
    sweepOfflineRunners(w.s.svc, t0);
    lastSeen(w, omarchy, t0 + 5_000, true);
    claim(w, first, omarchy, t0 + 6_000);
    sweepOfflineRunners(w.s.svc, t0 + 10_000);
    expect(notices(w)[0]?.recoveredAt).toBeNull();
    expect(notices(w)[0]?.backAt).toBe(t0 + 10_000);
    sweepOfflineRunners(w.s.svc, t0 + 10_000 + RUNNER_OFFLINE_NOTICE_MS);
    const [recovered] = notices(w);
    expect(recovered?.recoveredAt).not.toBeNull();
    expect(recovered?.todos.map((t) => t.state).sort()).toEqual(['started', 'waiting']);
    lastSeen(w, omarchy, t0 + 20_000);
    sweepOfflineRunners(w.s.svc, t0 + 20_000 + RUNNER_OFFLINE_NOTICE_MS + 1_000);
    const all = notices(w);
    expect(all).toHaveLength(2);
    expect(all.find((n) => n.id !== recovered?.id)?.todos).toHaveLength(1);
  });

  test('another online Runner is offered, and the action routes the task there', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    const mac = await machineOf(w, 'mac');
    routeOf(w, omarchy);
    const stepId = pendingStep(w);
    const now = Date.now();
    lastSeen(w, omarchy, now - RUNNER_OFFLINE_NOTICE_MS - 1_000);
    lastSeen(w, mac, now, true);
    sweepOfflineRunners(w.s.svc, now);
    const alternative = notices(w)[0]?.alternative;
    expect(alternative?.machineId).toBe(mac);
    const todoId = `todo-${stepId.slice('step-'.length)}`;
    expect(alternative?.todoIds).toEqual([todoId]);
    const res = await req(w.s.app, 'POST', `/api/todos/${todoId}/runner`, { machineId: mac });
    expect(res.status).toBe(200);
    const row = w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get();
    expect(row?.routeOverride?.machineId).toBe(mac);
    sweepOfflineRunners(w.s.svc, now + 30_000);
    expect(notices(w)[0]?.todos[0]?.state).toBe('moved');
    expect(notices(w)[0]?.alternative).toBeNull();
  });

  test('the action is refused on a task whose session already started, and the task stays put', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    const mac = await machineOf(w, 'mac');
    routeOf(w, omarchy);
    const stepId = pendingStep(w, { priorSession: { machineId: omarchy, sessionId: 'sess-1' } });
    const todoId = `todo-${stepId.slice('step-'.length)}`;
    const now = Date.now();
    lastSeen(w, omarchy, now - RUNNER_OFFLINE_NOTICE_MS - 1_000);
    sweepOfflineRunners(w.s.svc, now);
    expect(notices(w)[0]?.alternative).toBeNull();
    const res = await req(w.s.app, 'POST', `/api/todos/${todoId}/runner`, { machineId: mac });
    expect(res.status).toBe(409);
    const row = w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get();
    expect(row?.routeOverride ?? null).toBeNull();
  });

  test('a local-path project offers no other Runner and refuses the action', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    const mac = await machineOf(w, 'mac');
    routeOf(w, omarchy);
    w.s.db
      .update(projectTable)
      .set({ repoKind: 'local' })
      .where(eq(projectTable.id, w.projectId))
      .run();
    const stepId = pendingStep(w);
    const todoId = `todo-${stepId.slice('step-'.length)}`;
    const now = Date.now();
    lastSeen(w, omarchy, now - RUNNER_OFFLINE_NOTICE_MS - 1_000);
    lastSeen(w, mac, now, true);
    sweepOfflineRunners(w.s.svc, now);
    expect(notices(w)[0]?.alternative).toBeNull();
    const res = await req(w.s.app, 'POST', `/api/todos/${todoId}/runner`, { machineId: mac });
    expect(res.status).toBe(409);
  });

  test('the action is refused once the task has been claimed', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy');
    const mac = await machineOf(w, 'mac');
    routeOf(w, omarchy);
    const stepId = pendingStep(w);
    claim(w, stepId, omarchy, Date.now());
    const todoId = `todo-${stepId.slice('step-'.length)}`;
    const res = await req(w.s.app, 'POST', `/api/todos/${todoId}/runner`, { machineId: mac });
    expect(res.status).toBe(409);
  });
});
