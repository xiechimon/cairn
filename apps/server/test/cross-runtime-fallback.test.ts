import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { createCoordinatorServerApi } from '../src/coordinator/server-api.js';
import {
  chiefThread,
  gateVerdict,
  machine as machineTable,
  provider as providerTable,
  routingRule,
  step as stepTable,
} from '../src/db/schema.js';
import { providerHealth } from '../src/services/provider-health.js';
import {
  bootServer,
  insertClaudeSubscription,
  issueApiKey,
  postProject,
  seedRoute,
  seedSessionRoute,
  subscriptionClaudeReport,
  type TestServer,
} from './helpers.js';

const QUOTA_ERROR = '402: {"message":"insufficient quota: usage limit reached","type":..}';
const HEAD = 'ab'.repeat(20);
const PASS_FINDINGS = { conclusion: 'pass', findings: [] as [] };

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

function insertRelay(s: TestServer, providerId: string): void {
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

async function chiefWorld(
  fallbackModels: { provider: string; modelId: string }[] | null,
  opts: { claudeReport?: boolean } = {},
) {
  const s: TestServer = bootServer({ claimHoldMs: 100, pingIntervalMs: 3_600_000 });
  insertClaudeSubscription(s);
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  const key = await issueApiKey(s);
  for (const p of ['relay-a', 'relay-b']) insertRelay(s, p);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({ teamId, name: 'fallback-box', cliVersion: '0.1.0' }),
  });
  const { token } = (await enrollRes.json()) as { token: string };
  const machineId = s.db.select().from(machineTable).limit(1).all()[0]!.id;
  s.db
    .update(machineTable)
    .set({
      online: true,
      ...(opts.claudeReport === true ? { claudeCodeReport: subscriptionClaudeReport } : {}),
    })
    .where(eq(machineTable.id, machineId))
    .run();
  seedRoute(s, 'coordinator', {
    provider: 'relay-a',
    modelId: 'model-a',
    machineId,
    fallbackModels,
  });
  const projRes = await call(s.app, 'POST', '/api/projects', { body: { name: 'fallback-proj' } });
  const projectId = ((await projRes.json()) as { id: string }).id;

  let threadId: string | null = null;
  return {
    s,
    teamId,
    projectId,
    get threadId() {
      if (threadId === null) throw new Error('no thread yet');
      return threadId;
    },
    async send(content: string): Promise<string> {
      const res =
        threadId === null
          ? await call(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, { body: { content } })
          : await call(s.app, 'POST', `/api/conversations/${threadId}/messages`, {
              body: { content },
            });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { thread: { id: string }; message: { id: string } };
      threadId = body.thread.id;
      return body.message.id;
    },
    async claim(): Promise<ClaimedStep | null> {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
      const body = (await res.json()) as { step: unknown };
      return body.step ? claimedStepSchema.parse(body.step) : null;
    },
    async done(stepId: string, body: Record<string, unknown>): Promise<Response> {
      const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, { cred: token, body });
      return res;
    },
    async token(stepId: string) {
      const res = await call(s.app, 'GET', `/api/machine/token/${stepId}`, { cred: token });
      expect(res.status).toBe(200);
      return (await res.json()) as { provider: { providerId: string } | null };
    },
    stepRow(id: string) {
      return s.db.select().from(stepTable).where(eq(stepTable.id, id)).get();
    },
    threadRow() {
      return s.db
        .select()
        .from(chiefThread)
        .where(eq(chiefThread.id, threadId ?? ''))
        .get();
    },
  };
}

async function gateWorld(fallbackModels: { provider: string; modelId: string }[] | null): Promise<{
  s: TestServer;
  reviewerId: string;
  todoId: string;
  projectId: string;
  claim: () => Promise<ClaimedStep | null>;
  done: (stepId: string, body: Record<string, unknown>) => Promise<Response>;
  startBuild: () => Promise<string>;
}> {
  const s: TestServer = bootServer({ claimHoldMs: 100, pingIntervalMs: 3_600_000 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  for (const p of ['stub-gw', 'relay-b']) insertRelay(s, p);
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model' });
  const reviewerId = seedRoute(s, 'review', {
    provider: 'stub-gw',
    modelId: 'stub-model',
    fallbackModels,
  });
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({ teamId: s.team.id, name: 'gate-box', cliVersion: '0.1.0' }),
  });
  expect(enrollRes.status).toBe(200);
  const { token } = (await enrollRes.json()) as { token: string };
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'verdict binding probe', spec: 'fallback' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };
  return {
    s,
    reviewerId,
    todoId,
    projectId,
    async startBuild() {
      const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: { todoIds: [todoId] },
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
    },
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
      const body = (await res.json()) as { step: unknown };
      return body.step ? claimedStepSchema.parse(body.step) : null;
    },
    async done(stepId: string, body: Record<string, unknown>) {
      return call(s.app, 'POST', `/api/machine/done/${stepId}`, { cred: token, body });
    },
  };
}

describe('chief cross-runtime model fallback', () => {
  test('a claude-code backup takes over a pi turn on a machine that can run it', async () => {
    const w = await chiefWorld([{ provider: 'claude-code', modelId: 'claude-sonnet-5-5' }], {
      claudeReport: true,
    });
    await w.send('第一句');
    const running = await w.claim();
    expect(running?.agent?.provider).toBe('relay-a');
    const res = await w.done(running!.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
    });
    expect(res.status).toBe(200);
    const retried = await w.claim();
    expect(retried?.step.id).toBe(running!.step.id);
    expect(retried?.agent?.provider).toBe('claude-code');
    expect(retried?.agent?.modelId).toBe('claude-sonnet-5-5');
  });

  test('a machine that cannot run the effective fallback runtime cannot claim the turn', async () => {
    const w = await chiefWorld([{ provider: 'claude-code', modelId: 'claude-sonnet-5-5' }], {
      claudeReport: true,
    });
    await w.send('第一句');
    const running = await w.claim();
    await w.done(running!.step.id, { status: 'failed', errorMessage: QUOTA_ERROR });
    const row = w.stepRow(running!.step.id);
    expect(row?.fallback?.model).toEqual({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
    w.s.db.update(machineTable).set({ claudeCodeReport: null }).run();
    expect(await w.claim()).toBeNull();
    w.s.db.update(machineTable).set({ claudeCodeReport: subscriptionClaudeReport }).run();
    const retried = await w.claim();
    expect(retried?.agent?.provider).toBe('claude-code');
  });

  test('a turn that fell back to another runtime starts a fresh session and stamps its runtime', async () => {
    const w = await chiefWorld([{ provider: 'claude-code', modelId: 'claude-sonnet-5-5' }], {
      claudeReport: true,
    });
    await w.send('第一句');
    const first = await w.claim();
    expect(first?.agent?.provider).toBe('relay-a');
    await w.done(first!.step.id, { status: 'success', sessionId: 'pi-session-1' });
    expect(w.threadRow()?.sessionRuntime).toBe('pi');
    expect(w.threadRow()?.sessionId).toBe('pi-session-1');

    await w.send('第二句');
    const second = await w.claim();
    expect(second?.session).toEqual({ action: 'continue', sessionId: 'pi-session-1' });
    await w.done(second!.step.id, { status: 'failed', errorMessage: QUOTA_ERROR });

    const retried = await w.claim();
    expect(retried?.agent?.provider).toBe('claude-code');
    expect(retried?.session).toEqual({ action: 'new', sessionId: null });
    await w.done(retried!.step.id, { status: 'success', sessionId: 'claude-session-9' });
    expect(w.threadRow()?.sessionRuntime).toBe('claude-code');
    expect(w.threadRow()?.sessionId).toBe('claude-session-9');

    await w.send('第三句');
    const third = await w.claim();
    expect(third?.agent?.provider).toBe('relay-a');
    expect(third?.session).toEqual({ action: 'new', sessionId: null });
  });

  test('the token for a fallback claim resolves the fallback provider', async () => {
    const w = await chiefWorld([{ provider: 'relay-b', modelId: 'model-b' }]);
    await w.send('第一句');
    const first = await w.claim();
    await w.done(first!.step.id, { status: 'failed', errorMessage: QUOTA_ERROR });
    const retried = await w.claim();
    expect(retried?.agent?.provider).toBe('relay-b');
    const token = await w.token(retried!.step.id);
    expect(token.provider?.providerId).toBe('relay-b');
  });
});

describe('review and verify model fallback', () => {
  test('a review step retries on its fallback model', async () => {
    const w = await gateWorld([{ provider: 'relay-b', modelId: 'model-b' }]);
    const buildId = await w.startBuild();
    const first = await w.claim();
    expect(first?.step.kind).toBe('session');
    await w.done(first!.step.id, { status: 'success', hasChanges: true, commit: HEAD });
    const reviewStep = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, buildId))
      .all()
      .find((row) => row.kind === 'review');
    if (reviewStep === undefined) {
      w.s.db
        .insert(stepTable)
        .values({
          id: `legacy-review-${buildId}`,
          buildId,
          kind: 'review',
          status: 'pending',
          prompt: `${JSON.stringify({ kind: 'review', agentId: w.reviewerId, gate: 'review', expectedHeadSha: HEAD })}\n请审核`,
          createdAt: Date.now(),
        })
        .run();
    }
    const review = await w.claim();
    expect(review?.step.kind).toBe('review');
    expect(review?.agent?.provider).toBe('stub-gw');
    const failed = await w.done(review!.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
    });
    expect(failed.status).toBe(200);
    const retried = await w.claim();
    expect(retried?.step.id).toBe(review!.step.id);
    expect(retried?.agent?.provider).toBe('relay-b');
    expect(retried?.agent?.modelId).toBe('model-b');
  });

  test('a verify step retries on its session-route fallback model', async () => {
    const w = await gateWorld(null);
    w.s.db
      .update(routingRule)
      .set({ fallbackModels: [{ provider: 'relay-b', modelId: 'model-b' }] })
      .where(eq(routingRule.use, 'session'))
      .run();
    const buildId = await w.startBuild();
    const first = await w.claim();
    expect(first?.step.kind).toBe('session');
    await w.done(first!.step.id, { status: 'success', hasChanges: true, commit: HEAD });
    const verify = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, buildId))
      .all()
      .find((row) => row.kind === 'verify' && row.status === 'pending');
    if (verify === undefined) {
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-verify-${buildId}`,
          buildId,
          kind: 'verify',
          status: 'pending',
          prompt: `${JSON.stringify({ kind: 'verify', expectedHeadSha: HEAD })}\n请验证`,
          createdAt: Date.now() + 1,
        })
        .run();
    }
    const claimed = await w.claim();
    expect(claimed?.step.kind).toBe('verify');
    await w.done(claimed!.step.id, { status: 'failed', errorMessage: QUOTA_ERROR });
    const retried = await w.claim();
    expect(retried?.step.id).toBe(claimed!.step.id);
    expect(retried?.agent?.provider).toBe('relay-b');
    expect(retried?.agent?.modelId).toBe('model-b');
  });

  test('a review verdict records the model that actually ran it', async () => {
    const w = await gateWorld([{ provider: 'relay-b', modelId: 'model-b' }]);
    const buildId = await w.startBuild();
    const first = await w.claim();
    await w.done(first!.step.id, { status: 'success', hasChanges: true, commit: HEAD });
    w.s.db
      .insert(stepTable)
      .values({
        id: `legacy-review-${buildId}`,
        buildId,
        kind: 'review',
        status: 'pending',
        prompt: `${JSON.stringify({ kind: 'review', agentId: w.reviewerId, gate: 'review', expectedHeadSha: HEAD })}\n请审核`,
        createdAt: Date.now(),
      })
      .run();
    const review = await w.claim();
    expect(review?.step.kind).toBe('review');
    await w.done(review!.step.id, { status: 'failed', errorMessage: QUOTA_ERROR });
    const retried = await w.claim();
    const res = await w.done(retried!.step.id, {
      status: 'success',
      findings: PASS_FINDINGS,
    });
    expect(res.status).toBe(200);
    const verdict = w.s.db
      .select()
      .from(gateVerdict)
      .where(eq(gateVerdict.stepId, retried!.step.id))
      .get();
    expect(verdict).toBeDefined();
    expect(verdict?.outcome).toBe('pass');
    expect(verdict?.ranModel).toEqual({ provider: 'relay-b', modelId: 'model-b' });
  });
});

describe('claim generation fencing', () => {
  test('the claim payload stamps the claim generation on the step record', async () => {
    const w = await chiefWorld(null);
    await w.send('第一句');
    const running = await w.claim();
    const row = w.stepRow(running!.step.id);
    expect(running?.step.generation).toBe(row?.claimedAt);
    expect(running?.step.generation).not.toBeUndefined();
  });

  test('a done report carrying a superseded generation is rejected', async () => {
    const w = await chiefWorld(null);
    await w.send('第一句');
    const first = await w.claim();
    const generation = w.stepRow(first!.step.id)?.claimedAt;
    const stale = await w.done(first!.step.id, {
      status: 'success',
      generation: (generation ?? 0) - 1,
    });
    expect(stale.status).toBe(409);
  });

  test('an in-server done for a machine-owned or superseded claim is dropped', async () => {
    const w = await chiefWorld(null);
    await w.send('第一句');
    const first = await w.claim();
    const stepId = first!.step.id;
    const claimedAt = w.stepRow(stepId)?.claimedAt ?? 0;
    const api = createCoordinatorServerApi({
      db: w.s.db,
      hub: w.s.hub,
      machineHub: w.s.machineHub,
      box: w.s.secretBox,
      user: w.s.user,
      vapidKeys: w.s.vapidKeys,
      reposDir: w.s.reposDir,
      attachmentsDir: w.s.attachmentsDir,
      skillsDir: w.s.skillsDir,
      convHub: w.s.convHub,
    });
    await api.done(stepId, {
      status: 'success',
      sessionId: 'stale-session',
      generation: claimedAt - 1,
    });
    expect(w.stepRow(stepId)?.status).toBe('claimed');
    expect(w.threadRow()?.sessionId).toBe('');

    w.s.db
      .update(stepTable)
      .set({ claimedAt: claimedAt + 10 })
      .where(eq(stepTable.id, stepId))
      .run();
    await api.done(stepId, {
      status: 'success',
      sessionId: 'stale-session',
      generation: claimedAt,
    });
    expect(w.stepRow(stepId)?.status).toBe('claimed');
    expect(w.threadRow()?.sessionId).toBe('');
  });
});
