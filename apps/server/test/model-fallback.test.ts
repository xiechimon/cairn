import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  message as messageTable,
  notification as notificationTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { providerHealth } from '../src/services/provider-health.js';
import { sweepQuotaWaitSteps } from '../src/services/quota-wait.js';
import { bootServer, issueApiKey, postProject, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-fallback-1';

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
beforeEach(() => {
  providerHealth.reset();
});

interface World {
  s: TestServer;
  token: string;
  projectId: string;
  todoId: string;
}

function insertProvider(s: TestServer, providerId: string): void {
  s.db
    .insert(providerTable)
    .values({
      id: `prov-${providerId}`,
      teamId: s.team.id,
      kind: 'custom',
      providerId,
      label: providerId.toUpperCase(),
      baseUrl: `http://127.0.0.1:9/${providerId}`,
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'm', name: 'm' }],
      createdBy: s.user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

async function setupWorld(
  fallbackModels: { provider: string; modelId: string }[] | null = [
    { provider: 'relay-b', modelId: 'model-b' },
    { provider: 'relay-c', modelId: 'model-c' },
  ],
): Promise<World> {
  const s = bootServer({ claimHoldMs: 200, pingIntervalMs: 3_600_000 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  for (const p of ['relay-a', 'relay-b', 'relay-c']) insertProvider(s, p);
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'fallback-builder',
      provider: 'relay-a',
      modelId: 'model-a',
      fallbackModels,
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'fallback-box', cliVersion: '0.1.0' },
  });
  expect(enrollRes.status).toBe(200);
  const token = ((await enrollRes.json()) as { token: string }).token;
  const machineRow = s.db.select().from(machineTable).limit(1).all()[0]!;
  s.db
    .update(machineTable)
    .set({ enabledRuntimes: ['pi'] })
    .where(eq(machineTable.id, machineRow.id))
    .run();
  s.db
    .update(agentTable)
    .set({ machineId: machineRow.id })
    .where(eq(agentTable.id, AGENT_ID))
    .run();
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '降级链探针', spec: '写一行探针' },
  });
  const todoId = ((await todoRes.json()) as { id: string }).id;
  return { s, token, projectId, todoId };
}

async function startBuild(w: World): Promise<string> {
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

interface Claimed {
  stepId: string;
  provider: string | null;
  modelId: string | null;
  session: { action: string; sessionId: string | null };
}

async function claim(w: World): Promise<Claimed> {
  const res = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
    cred: w.token,
    body: {},
  });
  const body = (await res.json()) as {
    step?: {
      step?: { id?: string };
      agent?: { provider: string | null; modelId: string | null };
      session?: { action: string; sessionId: string | null };
    };
  };
  const stepId = body.step?.step?.id;
  if (!stepId) {
    throw new Error(`claim returned no step (status=${res.status} body=${JSON.stringify(body)})`);
  }
  return {
    stepId,
    provider: body.step?.agent?.provider ?? null,
    modelId: body.step?.agent?.modelId ?? null,
    session: body.step?.session ?? { action: '?', sessionId: null },
  };
}

async function done(w: World, stepId: string, body: Record<string, unknown>): Promise<void> {
  const res = await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, { cred: w.token, body });
  expect(res.status).toBe(200);
}

function quotaDone(providerId: string): Record<string, unknown> {
  return {
    status: 'failed',
    errorMessage: '402: quota exceeded',
    sessionId: `sess-${providerId}`,
    quotaBlock: { kind: 'quota', providerId, reason: '402: quota exceeded' },
  };
}

function stepRow(w: World, stepId: string) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
}

describe('model fallback chain (#1493)', () => {
  test('X1+X6+X9: primary model quota exhausted -> re-dispatch on the first fallback (fresh session, credential switches, visible)', async () => {
    const w = await setupWorld();
    const buildId = await startBuild(w);
    const first = await claim(w);
    expect(first.provider).toBe('relay-a');
    expect(first.modelId).toBe('model-a');
    await done(w, first.stepId, quotaDone('relay-a'));

    const row = stepRow(w, first.stepId);
    expect(row.status).toBe('pending');
    expect(row.machineId).toBeNull();
    expect(row.fallback?.model).toEqual({ provider: 'relay-b', modelId: 'model-b' });
    expect(row.fallback?.tried).toEqual(['relay-a/model-a', 'relay-b/model-b']);
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('building');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toBeNull();

    const again = await claim(w);
    expect(again.stepId).toBe(first.stepId);
    expect(again.provider).toBe('relay-b');
    expect(again.modelId).toBe('model-b');
    expect(again.session.action).toBe('new');
    const tokRes = await call(w.s.app, 'GET', `/api/machine/token/${again.stepId}`, {
      cred: w.token,
    });
    expect(tokRes.status).toBe(200);
    const tok = (await tokRes.json()) as { provider: { providerId: string } | null };
    expect(tok.provider?.providerId).toBe('relay-b');

    const notes = w.s.db
      .select()
      .from(messageTable)
      .where(and(eq(messageTable.conversationId, buildId), eq(messageTable.role, 'system')))
      .all();
    const note = notes.map((n) => String(n.content)).find((c) => c.includes('model-b'));
    expect(note).toContain('model-a');
    const notif = w.s.db
      .select()
      .from(notificationTable)
      .where(eq(notificationTable.entityId, w.todoId))
      .all();
    expect(notif.map((n) => n.type)).toContain('model_fallback');
  });

  test('X2: all fallbacks down -> fall back to waiting_quota, no infinite loop', async () => {
    const w = await setupWorld();
    await startBuild(w);
    const a = await claim(w);
    await done(w, a.stepId, quotaDone('relay-a'));
    const b = await claim(w);
    expect(b.provider).toBe('relay-b');
    await done(w, b.stepId, quotaDone('relay-b'));
    const c = await claim(w);
    expect(c.provider).toBe('relay-c');
    await done(w, c.stepId, quotaDone('relay-c'));
    const row = stepRow(w, a.stepId);
    expect(row.status).toBe('waiting_quota');
    expect(row.fallback?.tried).toHaveLength(3);
    expect(row.fallback?.model).toEqual({ provider: 'relay-c', modelId: 'model-c' });
  });

  test('X12: the degraded step suspends waiting for quota, resumes its own fallback session on release/claim', async () => {
    const w = await setupWorld([{ provider: 'relay-b', modelId: 'model-b' }]);
    await startBuild(w);
    const a = await claim(w);
    await done(w, a.stepId, quotaDone('relay-a'));
    const b = await claim(w);
    expect(b.session.action).toBe('new');
    await done(w, b.stepId, quotaDone('relay-b'));
    const held = stepRow(w, a.stepId);
    expect(held.status).toBe('waiting_quota');
    sweepQuotaWaitSteps(w.s.svc, held.quotaBlock!.probeAt + 1);
    const c = await claim(w);
    expect(c.provider).toBe('relay-b');
    expect(c.session).toEqual({ action: 'continue', sessionId: 'sess-relay-b' });
  });

  test.each(['review', 'merge'] as const)(
    'X3：%s 步禁止降级——额度用完只等不换（负对照）',
    async (kind) => {
      const w = await setupWorld();
      await startBuild(w);
      const pending = w.s.db.select().from(stepTable).where(eq(stepTable.status, 'pending')).get()!;
      w.s.db
        .update(stepTable)
        .set({
          kind,
          prompt: kind === 'review' ? `{"kind":"review","agentId":"${AGENT_ID}"}\n审一下` : null,
        })
        .where(eq(stepTable.id, pending.id))
        .run();
      const c = await claim(w);
      expect(c.stepId).toBe(pending.id);
      await done(w, c.stepId, quotaDone('relay-a'));
      const row = stepRow(w, c.stepId);
      expect(row.status).toBe('waiting_quota');
      expect(row.fallback).toBeNull();
      const notif = w.s.db
        .select()
        .from(notificationTable)
        .where(eq(notificationTable.type, 'model_fallback'))
        .all();
      expect(notif).toHaveLength(0);
    },
  );

  test('X4: agent has no fallbacks -> old behavior (waiting_quota)', async () => {
    const w = await setupWorld(null);
    await startBuild(w);
    const c = await claim(w);
    await done(w, c.stepId, quotaDone('relay-a'));
    const row = stepRow(w, c.stepId);
    expect(row.status).toBe('waiting_quota');
    expect(row.fallback).toBeNull();
  });

  test('a step whose first model answers 503 exhausted continues on the fallback model and succeeds', async () => {
    const w = await setupWorld();
    const buildId = await startBuild(w);
    const first = await claim(w);
    expect(first.provider).toBe('relay-a');
    expect(first.modelId).toBe('model-a');
    await done(w, first.stepId, {
      status: 'failed',
      errorMessage: '503 All available accounts exhausted',
      sessionId: 'sess-relay-a',
    });

    const switched = stepRow(w, first.stepId);
    expect(switched.status).toBe('pending');
    expect(switched.fallback?.model).toEqual({ provider: 'relay-b', modelId: 'model-b' });
    const again = await claim(w);
    expect(again.stepId).toBe(first.stepId);
    expect(again.provider).toBe('relay-b');
    expect(again.modelId).toBe('model-b');
    expect(again.session.action).toBe('new');
    await done(w, again.stepId, {
      status: 'success',
      sessionId: 'sess-relay-b',
      usage: [{ model: 'relay-b/model-b', input: 8, output: 3, cacheRead: 0, cacheWrite: 0 }],
    });

    expect(stepRow(w, first.stepId).status).toBe('done');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toBeNull();
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('review');
  });

  test('a rate-limited first model continues on the fallback model and succeeds', async () => {
    const w = await setupWorld();
    const buildId = await startBuild(w);
    const first = await claim(w);
    await done(w, first.stepId, {
      status: 'failed',
      errorMessage: '429 rate limited',
      quotaBlock: { kind: 'capacity', providerId: 'relay-a', reason: '429 rate limited' },
    });
    const switched = stepRow(w, first.stepId);
    expect(switched.status).toBe('pending');
    expect(switched.fallback?.model).toEqual({ provider: 'relay-b', modelId: 'model-b' });
    const again = await claim(w);
    expect(again.provider).toBe('relay-b');
    await done(w, again.stepId, {
      status: 'success',
      usage: [{ model: 'relay-b/model-b', input: 4, output: 2, cacheRead: 0, cacheWrite: 0 }],
    });
    expect(stepRow(w, first.stepId).status).toBe('done');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toBeNull();
  });

  test('503 exhausted with no fallback left fails the step', async () => {
    const w = await setupWorld([{ provider: 'relay-b', modelId: 'model-b' }]);
    await startBuild(w);
    const first = await claim(w);
    await done(w, first.stepId, {
      status: 'failed',
      errorMessage: '503 All available accounts exhausted',
    });
    expect(stepRow(w, first.stepId).status).toBe('pending');
    const second = await claim(w);
    expect(second.provider).toBe('relay-b');
    await done(w, second.stepId, {
      status: 'failed',
      errorMessage: '503 All available accounts exhausted',
    });
    const row = stepRow(w, first.stepId);
    expect(row.status).toBe('failed');
    expect(row.fallback?.model).toEqual({ provider: 'relay-b', modelId: 'model-b' });
  });

  test('X5: rate limit with no fallbacks still waits, and an exhausted chain waits on the last model', async () => {
    const bare = await setupWorld(null);
    await startBuild(bare);
    const only = await claim(bare);
    await done(bare, only.stepId, {
      status: 'failed',
      errorMessage: '429 rate limited',
      quotaBlock: { kind: 'capacity', providerId: 'relay-a', reason: '429 rate limited' },
    });
    const held = stepRow(bare, only.stepId);
    expect(held.status).toBe('waiting_quota');
    expect(held.fallback).toBeNull();

    const w = await setupWorld([{ provider: 'relay-b', modelId: 'model-b' }]);
    await startBuild(w);
    const first = await claim(w);
    await done(w, first.stepId, {
      status: 'failed',
      errorMessage: '429 rate limited',
      quotaBlock: { kind: 'capacity', providerId: 'relay-a', reason: '429 rate limited' },
    });
    const second = await claim(w);
    expect(second.provider).toBe('relay-b');
    await done(w, second.stepId, {
      status: 'failed',
      errorMessage: '429 rate limited',
      quotaBlock: { kind: 'capacity', providerId: 'relay-b', reason: '429 rate limited' },
    });
    const row = stepRow(w, first.stepId);
    expect(row.status).toBe('waiting_quota');
    expect(row.fallback?.model).toEqual({ provider: 'relay-b', modelId: 'model-b' });
  });

  test('X7: an open provider is not chosen as fallback', async () => {
    const w = await setupWorld();
    for (let i = 0; i < 5; i++) providerHealth.recordFailure('relay-b');
    expect(providerHealth.state('relay-b')).toBe('open');
    await startBuild(w);
    const c = await claim(w);
    await done(w, c.stepId, quotaDone('relay-a'));
    expect(stepRow(w, c.stepId).fallback?.model).toEqual({
      provider: 'relay-c',
      modelId: 'model-c',
    });
  });

  test('X8: a fallback whose runtime is not enabled on the home machine is skipped directly', async () => {
    const w = await setupWorld([
      { provider: 'claude-code', modelId: 'claude-sonnet' },
      { provider: 'relay-c', modelId: 'model-c' },
    ]);
    await startBuild(w);
    const c = await claim(w);
    await done(w, c.stepId, quotaDone('relay-a'));
    expect(stepRow(w, c.stepId).fallback?.model).toEqual({
      provider: 'relay-c',
      modelId: 'model-c',
    });
  });

  test('X10: model 404 and auth failure also switch', async () => {
    for (const errorMessage of [
      'POST /v1/messages 404 model_not_found',
      'Error: 401 {"type":"error","error":{"type":"authentication_error"}}',
    ]) {
      const w = await setupWorld();
      await startBuild(w);
      const c = await claim(w);
      await done(w, c.stepId, { status: 'failed', errorMessage });
      const row = stepRow(w, c.stepId);
      expect(row.status).toBe('pending');
      expect(row.fallback?.model).toEqual({ provider: 'relay-b', modelId: 'model-b' });
    }
  });

  test('circuit-breaker count: quota exhaustion records a provider streak of failures, success clears it', async () => {
    const w = await setupWorld();
    await startBuild(w);
    const a = await claim(w);
    await done(w, a.stepId, quotaDone('relay-a'));
    for (let i = 0; i < 2; i++) providerHealth.recordFailure('relay-a');
    expect(providerHealth.state('relay-a')).toBe('degraded');
    providerHealth.recordFailure('relay-b');
    const b = await claim(w);
    await done(w, b.stepId, {
      status: 'success',
      usage: [{ model: 'relay-b/model-b', input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }],
    });
    expect(providerHealth.state('relay-b')).toBe('healthy');
    expect(providerHealth.state('relay-a')).toBe('degraded');
  });
});

describe('0 token silent failure (#1493)', () => {
  const zeroUsage = [
    { model: 'relay-a/model-a', input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  ];

  test('X11: success but 0 tokens and no output -> retry once on the same model, one more turns into failure wrap-up', async () => {
    const w = await setupWorld(null);
    const buildId = await startBuild(w);
    const a = await claim(w);
    await done(w, a.stepId, { status: 'success', usage: zeroUsage, noOutput: true });
    let row = stepRow(w, a.stepId);
    expect(row.status).toBe('pending');
    expect(row.fallback?.zeroUsageRetried).toBe(true);
    expect(row.fallback?.model).toBeNull();
    const b = await claim(w);
    expect(b.stepId).toBe(a.stepId);
    expect(b.provider).toBe('relay-a');
    await done(w, b.stepId, { status: 'success', usage: zeroUsage, noOutput: true });
    row = stepRow(w, a.stepId);
    expect(row.status).toBe('failed');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toContain('0 token');
  });

  test('X11 negative control: 0 token but daemon did not say no output (relay returning no usage) not judged', async () => {
    const w = await setupWorld(null);
    await startBuild(w);
    const a = await claim(w);
    await done(w, a.stepId, { status: 'success', usage: zeroUsage });
    expect(stepRow(w, a.stepId).status).not.toBe('pending');
    expect(stepRow(w, a.stepId).fallback).toBeNull();
  });

  test('X11 negative control: no usage reported (legacy daemon) not judged', async () => {
    const w = await setupWorld(null);
    await startBuild(w);
    const a = await claim(w);
    await done(w, a.stepId, { status: 'success' });
    expect(stepRow(w, a.stepId).status).not.toBe('pending');
    expect(stepRow(w, a.stepId).fallback).toBeNull();
  });
});

describe('agent write surface (#1493)', () => {
  test('PATCH fallbackModels: persisted + record projection + more than 5 -> 400 + null clears', async () => {
    const w = await setupWorld(null);
    const path = `/api/teams/${w.s.team.id}/agents/${AGENT_ID}`;
    const six = Array.from({ length: 6 }, (_, i) => ({ provider: 'relay-b', modelId: `m${i}` }));
    expect((await call(w.s.app, 'PATCH', path, { body: { fallbackModels: six } })).status).toBe(
      400,
    );
    const ok = await call(w.s.app, 'PATCH', path, {
      body: { fallbackModels: [{ provider: 'relay-b', modelId: 'model-b' }] },
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { fallbackModels: unknown }).fallbackModels).toEqual([
      { provider: 'relay-b', modelId: 'model-b' },
    ]);
    const cleared = await call(w.s.app, 'PATCH', path, { body: { fallbackModels: null } });
    expect(((await cleared.json()) as { fallbackModels: unknown }).fallbackModels).toBeNull();
  });
});
