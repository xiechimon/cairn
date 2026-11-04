import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  message as messageTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { QUOTA_HOLD_BACKOFF_MS } from '../src/services/dispatch-timeouts.js';
import { toTodoRecord } from '../src/services/todos.js';
import { bootServer, issueApiKey, postProject } from './helpers.js';

const QUOTA_ERROR = '402: {"message":"insufficient quota: usage limit reached","type":..}';
const NETWORK_ERROR = 'upstream stream disconnected: connection reset by peer';

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

const AGENT_ID = 'agent-quota-1';

async function setupWorld() {
  const s = bootServer({ claimHoldMs: 200 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-quota',
      teamId: s.team.id,
      kind: 'custom',
      providerId: 'stub-gw',
      label: 'Stub Gateway',
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
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'quota-mbp', cliVersion: '0.1.0' },
  });
  const { token } = (await enrollRes.json()) as { token: string };
  const machineId = s.db.select().from(machineTable).limit(1).all()[0]!.id;
  s.db.update(machineTable).set({ online: true }).where(eq(machineTable.id, machineId)).run();
  s.db.update(agentTable).set({ machineId }).where(eq(agentTable.id, AGENT_ID)).run();
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '额度探针任务', spec: '写一行探针到 README.md' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };

  async function startBuild(): Promise<string> {
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [todoId],
        assignment: { plan: null, build: { agentId: AGENT_ID } },
        withPlan: false,
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { builds: { id: string }[] };
    return body.builds[0]!.id;
  }
  async function claim(): Promise<ClaimedStep | null> {
    const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
    const body = (await res.json()) as { step: unknown };
    if (!body.step) return null;
    return claimedStepSchema.parse(body.step);
  }
  async function done(stepId: string, body: Record<string, unknown>): Promise<void> {
    const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, { cred: token, body });
    if (res.status !== 200) throw new Error(`done returned ${res.status}`);
  }
  const todoRow = () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
  const buildRow = (buildId: string) =>
    s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
  const stepRow = (stepId: string) =>
    s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
  const messagesOf = (conversationId: string) =>
    s.db.select().from(messageTable).where(eq(messageTable.conversationId, conversationId)).all();
  return {
    s,
    token,
    machineId,
    todoId,
    startBuild,
    claim,
    done,
    todoRow,
    buildRow,
    stepRow,
    messagesOf,
  };
}

describe('#1257 quota hold (done-surface classification + the hold/resume loop)', () => {
  test('failure mode 1: a quota failure -> held (pending + machine slot cleared + the sessionId resume surface + holdUntil at the first tier; zero failure traces + a step pending event + a waiting-for-quota row)', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild();
    const events: object[] = [];
    const untap = w.s.convHub.subscribe(buildId, {
      nextSeq: () => 1,
      send: (payload: object) => {
        events.push(payload);
        return Promise.resolve();
      },
    });
    const step = (await w.claim())!;
    expect(step.step.kind).toBe('build');

    const before = Date.now();
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-quota-1',
    });

    const row = w.stepRow(step.step.id);
    expect(row.status).toBe('pending');
    expect(row.machineId).toBeNull();
    expect(row.sessionId).toBe('pi-sess-quota-1');
    expect(row.holdReason).toBe('quota');
    expect(row.holdCount).toBe(1);
    expect(row.holdUntil).not.toBeNull();
    expect(row.holdUntil! - before).toBeGreaterThanOrEqual(QUOTA_HOLD_BACKOFF_MS[0]! - 1_000);
    expect(row.holdUntil! - before).toBeLessThanOrEqual(QUOTA_HOLD_BACKOFF_MS[0]! + 5_000);
    expect(w.todoRow().phase).not.toBe('failed');
    expect(w.buildRow(buildId).errorMessage).toBeNull();
    const stepEvents = events.filter(
      (e): e is { type: string; step: { status: string; id: string } } =>
        (e as { type?: string }).type === 'step',
    );
    const stepEv = stepEvents[stepEvents.length - 1];
    expect(stepEv?.step.status).toBe('pending');
    const holdRows = w.messagesOf(buildId).filter((m) => m.id === `quota-hold-${step.step.id}`);
    expect(holdRows).toHaveLength(1);
    expect(holdRows[0]!.role).toBe('system');
    const content = String(holdRows[0]!.content);
    expect(content).toContain('等额度');
    expect(content).toContain('下次尝试');
    untap();
  });

  test('failure mode 2: nothing claims while held (holdUntil not reached)', async () => {
    const w = await setupWorld();
    await w.startBuild();
    const step = (await w.claim())!;
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-quota-1',
    });
    expect(w.stepRow(step.step.id).status).toBe('pending');

    const claimed = await w.claim();
    expect(claimed).toBeNull();
  });

  test('failure mode 3: claimable once holdUntil passes, the session payload continue + the held step own sessionId (auto-resumes when the quota returns)', async () => {
    const w = await setupWorld();
    await w.startBuild();
    const step = (await w.claim())!;
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-quota-1',
    });
    w.s.db
      .update(stepTable)
      .set({ holdUntil: Date.now() - 1 })
      .where(eq(stepTable.id, step.step.id))
      .run();

    const reclaimed = await w.claim();
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.step.id).toBe(step.step.id);
    expect(reclaimed!.session.action).toBe('continue');
    expect(reclaimed!.session.sessionId).toBe('pi-sess-quota-1');
  });

  test('failure mode 4: the resume fails with quota again -> backoff raised to the second tier', async () => {
    const w = await setupWorld();
    await w.startBuild();
    const step = (await w.claim())!;
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-1',
    });
    w.s.db
      .update(stepTable)
      .set({ holdUntil: Date.now() - 1 })
      .where(eq(stepTable.id, step.step.id))
      .run();
    const reclaimed = (await w.claim())!;
    const before = Date.now();
    await w.done(reclaimed.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-2',
    });

    const row = w.stepRow(step.step.id);
    expect(row.holdCount).toBe(2);
    expect(row.holdUntil! - before).toBeGreaterThanOrEqual(QUOTA_HOLD_BACKOFF_MS[1]! - 1_000);
    expect(row.holdUntil! - before).toBeLessThanOrEqual(QUOTA_HOLD_BACKOFF_MS[1]! + 5_000);
  });

  test('failure mode 5: backoff caps from the third tier on', async () => {
    const w = await setupWorld();
    await w.startBuild();
    const step = (await w.claim())!;
    w.s.db
      .update(stepTable)
      .set({ holdReason: 'quota', holdCount: 2, holdUntil: Date.now() - 1 })
      .where(eq(stepTable.id, step.step.id))
      .run();
    w.s.db
      .update(stepTable)
      .set({ status: 'claimed', machineId: w.machineId })
      .where(eq(stepTable.id, step.step.id))
      .run();
    const before = Date.now();
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-3',
    });

    const row = w.stepRow(step.step.id);
    expect(row.holdCount).toBe(3);
    expect(row.holdUntil! - before).toBeGreaterThanOrEqual(QUOTA_HOLD_BACKOFF_MS[2]! - 1_000);
    expect(row.holdUntil! - before).toBeLessThanOrEqual(QUOTA_HOLD_BACKOFF_MS[2]! + 5_000);
    w.s.db
      .update(stepTable)
      .set({ holdCount: 9, holdUntil: Date.now() - 1, status: 'claimed', machineId: w.machineId })
      .where(eq(stepTable.id, step.step.id))
      .run();
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-4',
    });
    const capped = w.stepRow(step.step.id);
    expect(capped.holdCount).toBe(10);
    expect(capped.holdUntil! - before).toBeLessThanOrEqual(QUOTA_HOLD_BACKOFF_MS[2]! + 5_000);
  });

  test('failure mode 6: a non-quota failure (network text) -> the existing failure funnel (step/todo failed + errorMessage)', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild();
    const step = (await w.claim())!;

    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: NETWORK_ERROR,
      sessionId: 'pi-sess-net-1',
    });

    expect(w.stepRow(step.step.id).status).toBe('failed');
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow(buildId).errorMessage).toContain('upstream stream disconnected');
  });

  test('the backoff tiers have a single source (60s -> 5min -> capped at 15min)', () => {
    expect(QUOTA_HOLD_BACKOFF_MS).toEqual([60_000, 300_000, 900_000]);
  });
});

describe('#1257 the waitingOn board derivation (waiting-for-machine / waiting-for-quota distinguished from the failed red state)', () => {
  test('a quota hold -> waitingOn {on:"quota", retryAt=holdUntil}', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild();
    const step = (await w.claim())!;
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-quota-1',
    });

    const record = toTodoRecord(w.s.svc, w.todoRow());
    expect(record.waitingOn).toEqual({
      on: 'quota',
      retryAt: w.stepRow(step.step.id).holdUntil,
    });
    expect(buildId).not.toBeNull();
  });

  test('the owning machine offline -> waitingOn {on:"machine"}', async () => {
    const w = await setupWorld();
    await w.startBuild();
    w.s.db
      .update(machineTable)
      .set({ online: false })
      .where(eq(machineTable.id, w.machineId))
      .run();

    const record = toTodoRecord(w.s.svc, w.todoRow());
    expect(record.waitingOn).toEqual({ on: 'machine', retryAt: null });
  });

  test('the team has zero online machines -> waitingOn {on:"machine"}', async () => {
    const w = await setupWorld();
    await w.startBuild();
    w.s.db
      .update(machineTable)
      .set({ online: false })
      .where(eq(machineTable.id, w.machineId))
      .run();

    const record = toTodoRecord(w.s.svc, w.todoRow());
    expect(record.waitingOn).toEqual({ on: 'machine', retryAt: null });
  });

  test('the machine healthy and claimable -> waitingOn absent (ordinary queuing, not a hold)', async () => {
    const w = await setupWorld();
    await w.startBuild();

    const record = toTodoRecord(w.s.svc, w.todoRow());
    expect(record.waitingOn).toBeUndefined();
  });

  test('a non-in-flight phase -> waitingOn absent (the derivation answers only holds of in-flight cards)', async () => {
    const w = await setupWorld();
    w.s.db
      .update(machineTable)
      .set({ online: false })
      .where(eq(machineTable.id, w.machineId))
      .run();

    const record = toTodoRecord(w.s.svc, w.todoRow());
    expect(record.waitingOn).toBeUndefined();
  });
});
