import {
  type ClaimedStep,
  claimedStepSchema,
  machineUploadUrlsResponseSchema,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  notification as notificationTable,
  provider as providerTable,
  step as stepTable,
  stopPending as stopPendingTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  withVerification,
} from './helpers.js';

const AGENT_ID = 'agent-stop-1';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown; text?: string; contentType?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.contentType !== undefined) headers['content-type'] = opts.contentType;
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : opts.text,
    }),
  );
}

async function setupWorld() {
  const s = bootServer({ claimHoldMs: 200, pingIntervalMs: 3_600_000 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-stop',
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
      displayName: 'stub-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
      tools: ['合并分支', '推送分支'],
    })
    .run();
  async function enroll(name: string, cred: string): Promise<string> {
    const res = await call(s.app, 'POST', '/api/machine/enroll', {
      cred,
      body: { teamId: s.team.id, name, cliVersion: '0.1.0' },
    });

    bindAllAgents(s);
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  }
  const token = await enroll('stop-mbp', key);
  const otherToken = await enroll('other-mbp', await issueApiKey(s));
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '停止探针', spec: '写一行停止探针到 README.md' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };

  async function startBuild(withPlan = true): Promise<string> {
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [todoId],
        assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
        withPlan,
      },
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
  }
  async function claim(): Promise<ClaimedStep> {
    const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
    const body = (await res.json()) as { step: unknown };
    if (!body.step) throw new Error('claim returned no step');
    return claimedStepSchema.parse(body.step);
  }
  async function done(stepId: string, body: Record<string, unknown>): Promise<void> {
    const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, { cred: token, body });
    expect(res.status).toBe(200);
  }
  async function uploadPlan(stepId: string, content: string): Promise<void> {
    const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      cred: token,
      body: { files: [{ name: PLAN_FILE_NAME }] },
    });
    const urls = machineUploadUrlsResponseSchema.parse(await urlsRes.json());
    const up = urls.uploads[0]!;
    const put = await call(s.app, 'PUT', up.url.replace(/^https?:\/\/[^/]+/, ''), {
      cred: token,
      text: content,
      contentType: 'text/markdown',
    });
    expect(put.status).toBe(200);
  }
  async function stop(buildId: string, discard: boolean): Promise<Response> {
    return call(s.app, 'POST', `/api/builds/${buildId}/stop`, { body: { discard } });
  }
  const todoRow = () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
  const buildRow = (buildId: string) =>
    s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
  const stepsOf = (buildId: string) =>
    s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
  const notificationCount = () =>
    s.db.select({ n: sql<number>`count(*)` }).from(notificationTable).get()?.n ?? 0;
  const chiefStepCount = () =>
    s.db
      .select({ n: sql<number>`count(*)` })
      .from(stepTable)
      .where(eq(stepTable.kind, 'chief'))
      .get()?.n ?? 0;
  async function confirm(buildId: string): Promise<void> {
    const res = await call(s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'confirm' },
    });
    expect(res.status).toBe(202);
  }
  return {
    s,
    token,
    otherToken,
    todoId,
    startBuild,
    claim,
    done,
    uploadPlan,
    stop,
    confirm,
    todoRow,
    buildRow,
    stepsOf,
    notificationCount,
    chiefStepCount,
  };
}

type World = Awaited<ReturnType<typeof setupWorld>>;

describe('the stop server write surface (M7 #308)', () => {
  let w: World;
  beforeEach(async () => {
    w = await setupWorld();
  });

  test('failure mode 1: no active step 409; an unknown build 404; missing discard 400', async () => {
    const buildId = await w.startBuild(true);
    const unknown = await call(w.s.app, 'POST', '/api/builds/does-not-exist/stop', {
      body: { discard: true },
    });
    expect(unknown.status).toBe(404);
    const badBody = await call(w.s.app, 'POST', `/api/builds/${buildId}/stop`, { body: {} });
    expect(badBody.status).toBe(400);
    const claimed = await w.claim();
    await w.uploadPlan(claimed.step.id, withVerification('# plan v1'));
    await w.done(claimed.step.id, { status: 'success' });
    const late = await w.stop(buildId, true);
    expect(late.status).toBe(409);
    expect(Object.keys((await late.json()) as object)).toEqual(['error']);
  });

  test('failure mode 2: a pending step -> canceled by the server at once (step stopped + prevPhase falls back + canceled)', async () => {
    const buildId = await w.startBuild(true);
    const res = await w.stop(buildId, true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ delegated: false });
    const steps = w.stepsOf(buildId);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.status).toBe('stopped');
    expect(w.todoRow().phase).toBe('todo');
    expect(w.buildRow(buildId).errorMessage).toBe('已取消');
    expect(w.s.db.select().from(stopPendingTable).all()).toHaveLength(0);
  });

  test('failure mode 3: a claimed step -> single-slot pending + an SSE stop signal + 202 delegated', async () => {
    const buildId = await w.startBuild(true);
    const claimed = await w.claim();
    const events: unknown[] = [];
    const unsubscribe = w.s.machineHub.subscribe(w.s.team.id, (ev) => events.push(ev));
    const res = await w.stop(buildId, true);
    unsubscribe();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ delegated: true });
    expect(events).toEqual([{ type: 'stop', stepId: claimed.step.id }]);
    expect(w.stepsOf(buildId)[0]!.status).toBe('claimed');
    expect(w.todoRow().phase).toBe('planning');
    const pending = w.s.db.select().from(stopPendingTable).all();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      conversationId: buildId,
      stepId: claimed.step.id,
      discard: true,
    });
  });

  test('failure mode 4: fetch-acknowledge (first fetch / second fetch / 401 / another machine does not consume)', async () => {
    const buildId = await w.startBuild(true);
    const claimed = await w.claim();
    await w.stop(buildId, false);
    const stepId = claimed.step.id;
    const noCred = await call(w.s.app, 'GET', `/api/machine/stop?stepId=${stepId}`);
    expect(noCred.status).toBe(401);
    const other = await call(w.s.app, 'GET', `/api/machine/stop?stepId=${stepId}`, {
      cred: w.otherToken,
    });
    expect(await other.json()).toEqual({ discard: null });
    expect(w.s.db.select().from(stopPendingTable).all()).toHaveLength(1);
    const first = await call(w.s.app, 'GET', `/api/machine/stop?stepId=${stepId}`, {
      cred: w.token,
    });
    expect(await first.json()).toEqual({ discard: false });
    const second = await call(w.s.app, 'GET', `/api/machine/stop?stepId=${stepId}`, {
      cred: w.token,
    });
    expect(await second.json()).toEqual({ discard: null });
  });

  test('failure mode 5: the old step pending -> the new step fetch gets null + discard', async () => {
    const buildId = await w.startBuild(true);
    const first = await w.claim();
    await w.uploadPlan(first.step.id, withVerification('# plan v1'));
    await w.stop(buildId, true);
    await w.done(first.step.id, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    await w.confirm(buildId);
    const next = await w.claim();
    expect(next.step.id).not.toBe(first.step.id);
    const fetch = await call(w.s.app, 'GET', `/api/machine/stop?stepId=${next.step.id}`, {
      cred: w.token,
    });
    expect(await fetch.json()).toEqual({ discard: null });
    expect(w.s.db.select().from(stopPendingTable).all()).toHaveLength(0);
  });

  test('failure mode 6a: stopping the first-round plan step (claimed -> done(stopped)) -> prevPhase falls back', async () => {
    const buildId = await w.startBuild(true);
    const claimed = await w.claim();
    await w.stop(buildId, true);
    await w.done(claimed.step.id, { status: 'stopped', sessionId: 'pi-s-1' });
    expect(w.stepsOf(buildId)[0]!.status).toBe('stopped');
    expect(w.todoRow().phase).toBe('todo');
    expect(w.buildRow(buildId).errorMessage).toBe('已取消');
    const face = await call(w.s.app, 'GET', `/api/builds/${buildId}/steps`);
    expect(face.status).toBe(200);
    const rows = (await face.json()) as { status: string }[];
    expect(rows[0]!.status).toBe('stopped');
  });

  test('failure modes 6b/7: stopping the build step -> confirm falls back (plan v1 kept) and no notification', async () => {
    const buildId = await w.startBuild(true);
    const planStep = await w.claim();
    await w.uploadPlan(planStep.step.id, withVerification('# plan v1'));
    await w.done(planStep.step.id, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    await w.confirm(buildId);
    const buildStep = await w.claim();
    expect(w.todoRow().phase).toBe('building');
    const before = w.notificationCount();
    const chiefBefore = w.chiefStepCount();
    await w.stop(buildId, true);
    await w.done(buildStep.step.id, { status: 'stopped' });
    expect(w.todoRow().phase).toBe('confirm');
    const plans = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
    expect(plans?.planDocId).not.toBeNull();
    expect(w.notificationCount()).toBe(before);
    expect(w.chiefStepCount()).toBe(chiefBefore);
    expect(w.s.db.select().from(stopPendingTable).all()).toHaveLength(0);
  });

  test('failure mode 6c: stopping the merge step -> review unchanged', async () => {
    const buildId = await w.startBuild(true);
    const planStep = await w.claim();
    await w.uploadPlan(planStep.step.id, withVerification('# plan v1'));
    await w.done(planStep.step.id, { status: 'success' });
    await w.confirm(buildId);
    const buildStep = await w.claim();
    await w.done(buildStep.step.id, { status: 'success', hasChanges: true });
    expect(w.todoRow().phase).toBe('review');
    const merge = await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    expect(merge.status).toBe(202);
    const mergeStep = await w.claim();
    expect(mergeStep.step.kind).toBe('merge');
    await w.stop(buildId, false);
    await w.done(mergeStep.step.id, { status: 'stopped' });
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow(buildId).errorMessage).toBe('已取消');
  });

  test('failure mode 8: a double stop overwrites the single slot (the later discard wins); after stopped 409', async () => {
    const buildId = await w.startBuild(true);
    const claimed = await w.claim();
    await w.stop(buildId, true);
    await w.stop(buildId, false);
    const pending = w.s.db.select().from(stopPendingTable).all();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.discard).toBe(false);
    await w.done(claimed.step.id, { status: 'stopped' });
    const again = await w.stop(buildId, true);
    expect(again.status).toBe(409);
  });

  test('failure mode 9: after stop is booked, the steer fetch -> null (the step is not claimed)', async () => {
    const buildId = await w.startBuild(true);
    const claimed = await w.claim();
    await call(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, {
      body: { content: '顺便补一句' },
    });
    await w.stop(buildId, true);
    await w.done(claimed.step.id, { status: 'stopped' });
    const steerFetch = await call(w.s.app, 'GET', `/api/machine/steer?stepId=${claimed.step.id}`, {
      cred: w.token,
    });
    expect(await steerFetch.json()).toEqual({ content: null });
  });

  test('chief conversations are outside the stop surface: a chief- prefixed id -> 404 (stop gates on the build table)', async () => {
    const res = await call(w.s.app, 'POST', '/api/builds/chief-stop-probe/stop', {
      body: { discard: true },
    });
    expect(res.status).toBe(404);
  });
});
