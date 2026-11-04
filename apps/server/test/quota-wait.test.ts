import { eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  notification as notificationTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { sweepQuotaWaitSteps } from '../src/services/quota-wait.js';
import { bootServer, issueApiKey, postProject, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-quota-1';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface QuotaWorld {
  s: TestServer;
  token: string;
  projectId: string;
  todoId: string;
}

async function setupWorld(): Promise<QuotaWorld> {
  const s = bootServer({ claimHoldMs: 200, pingIntervalMs: 3_600_000 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-quota',
      teamId: s.team.id,
      kind: 'custom',
      providerId: 'relay-186',
      label: 'Relay 186',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
      createdBy: s.user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'quota-builder',
      provider: 'relay-186',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'quota-box', cliVersion: '0.1.0' },
  });
  expect(enrollRes.status).toBe(200);
  const token = ((await enrollRes.json()) as { token: string }).token;
  const machineRow = s.db.select().from(machineTable).limit(1).all()[0]!;
  s.db
    .update(agentTable)
    .set({ machineId: machineRow.id })
    .where(eq(agentTable.id, AGENT_ID))
    .run();
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '配额挂起探针', spec: '写一行探针' },
  });
  const todoId = ((await todoRes.json()) as { id: string }).id;
  return { s, token, projectId, todoId };
}

async function startBuild(w: QuotaWorld): Promise<string> {
  const res = await call(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
    body: {
      todoIds: [w.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: false,
    },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
}

async function claim(w: QuotaWorld): Promise<{ stepId: string }> {
  const res = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
    cred: w.token,
    body: {},
  });
  const body = (await res.json()) as { step?: { step?: { id?: string } } };
  const stepId = body.step?.step?.id;
  if (!stepId) {
    throw new Error(`claim returned no step (status=${res.status} body=${JSON.stringify(body)})`);
  }
  return { stepId };
}

async function done(w: QuotaWorld, stepId: string, body: Record<string, unknown>): Promise<void> {
  const res = await call(w.s.app, `POST`, `/api/machine/done/${stepId}`, { cred: w.token, body });
  expect(res.status).toBe(200);
}

const QUOTA_BLOCK = {
  kind: 'quota',
  providerId: 'relay-186',
  label: 'Relay 186',
  reason: '402: quota exceeded',
} as const;

describe('quota hold (#1261)', () => {
  test('W1+W2+W3: a quota done -> waiting_quota hold + notification + read-surface projection', async () => {
    const w = await setupWorld();
    const buildId = await startBuild(w);
    const { stepId } = await claim(w);
    await done(w, stepId, {
      status: 'failed',
      errorMessage: '402: quota exceeded',
      quotaBlock: QUOTA_BLOCK,
    });
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('building');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toBeNull();
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    expect(stepRow.status).toBe('waiting_quota');
    const notif = w.s.db
      .select()
      .from(notificationTable)
      .where(eq(notificationTable.entityId, w.todoId))
      .all();
    expect(notif).toHaveLength(1);
    expect(notif[0]!.type).toBe('quota_wait');
    expect(notif[0]!.snippet).toContain('Relay 186');
    const todosRes = await call(w.s.app, 'GET', '/api/todos');
    const todos = (await todosRes.json()) as {
      id: string;
      quotaWait?: { kind: string; providerId: string; probeAt: number } | null;
    }[];
    const row = todos.find((t) => t.id === w.todoId);
    expect(row?.quotaWait?.kind).toBe('quota');
    expect(row?.quotaWait?.providerId).toBe('relay-186');
    expect(typeof row?.quotaWait?.probeAt).toBe('number');
  });

  test('W4: probeAt due -> released back to pending + machineId cleared (auto-resumes when the quota returns)', async () => {
    const w = await setupWorld();
    await startBuild(w);
    const { stepId } = await claim(w);
    const at = Date.now();
    await done(w, stepId, {
      status: 'failed',
      errorMessage: '429: rate limited',
      quotaBlock: { ...QUOTA_BLOCK, kind: 'capacity', retryAfterMs: 60_000 },
    });
    let stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    expect(stepRow.status).toBe('waiting_quota');
    const probeAtBefore = (stepRow.quotaBlock as { probeAt: number }).probeAt;
    sweepQuotaWaitSteps(w.s.svc, at + 1_000);
    stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    expect(stepRow.status).toBe('waiting_quota');
    sweepQuotaWaitSteps(w.s.svc, probeAtBefore + 1);
    stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    expect(stepRow.status).toBe('pending');
    expect(stepRow.machineId).toBeNull();
    const todosRes = await call(w.s.app, 'GET', '/api/todos');
    const todos = (await todosRes.json()) as { id: string; quotaWait?: unknown }[];
    const row = todos.find((t) => t.id === w.todoId);
    expect(row?.quotaWait == null).toBe(true);
  });

  test('W5: repeated holds increase the backoff (interval x2), the first-seen time kept', async () => {
    const w = await setupWorld();
    await startBuild(w);
    const { stepId } = await claim(w);
    await done(w, stepId, {
      status: 'failed',
      errorMessage: '402 again',
      quotaBlock: QUOTA_BLOCK,
    });
    const first = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    const b1 = first.quotaBlock as {
      probeAt: number;
      firstSeenAt: number;
      lastAt: number;
      attempts: number;
    };
    expect(b1.attempts).toBe(1);
    const window1 = b1.probeAt - b1.lastAt;
    expect(window1).toBeGreaterThan(0);
    sweepQuotaWaitSteps(w.s.svc, b1.probeAt + 1);
    const pendingRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    expect(pendingRow.status).toBe('pending');
    const { stepId: again } = await claim(w);
    expect(again).toBe(stepId);
    await done(w, stepId, {
      status: 'failed',
      errorMessage: '402 again',
      quotaBlock: QUOTA_BLOCK,
    });
    const second = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    const b2 = second.quotaBlock as {
      probeAt: number;
      firstSeenAt: number;
      lastAt: number;
      attempts: number;
    };
    expect(b2.attempts).toBe(2);
    expect(b2.firstSeenAt).toBe(b1.firstSeenAt);
    expect(b2.probeAt - b2.lastAt).toBe(window1 * 2);
  });

  test('W6: a waiting_quota step can be stopped (the stop button = the server-side immediate cancel surface)', async () => {
    const w = await setupWorld();
    const buildId = await startBuild(w);
    const { stepId } = await claim(w);
    await done(w, stepId, {
      status: 'failed',
      errorMessage: '402',
      quotaBlock: QUOTA_BLOCK,
    });
    const res = await call(w.s.app, 'POST', `/api/builds/${buildId}/stop`, {
      body: { discard: true },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { delegated: boolean }).delegated).toBe(false);
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    expect(stepRow.status).toBe('stopped');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).not.toBeNull();
  });

  test('W7: a non-quota done(failed) -> zero regression in the old failure funnel (todo failed, no quota notification)', async () => {
    const w = await setupWorld();
    await startBuild(w);
    const { stepId } = await claim(w);
    await done(w, stepId, { status: 'failed', errorMessage: '400: bad protocol' });
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('failed');
    const quotaNotifs = w.s.db
      .select({ n: sql<number>`count(*)` })
      .from(notificationTable)
      .where(eq(notificationTable.type, 'quota_wait'))
      .get();
    expect(quotaNotifs?.n ?? 0).toBe(0);
  });
});
