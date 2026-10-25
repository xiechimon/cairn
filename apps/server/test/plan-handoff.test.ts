import type { ClaimedStep } from '@cairn/shared';
import {
  claimedStepSchema,
  conversationStreamEventSchema,
  machineUploadUrlsResponseSchema,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  plan as planTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  openConvStream,
  postProject,
  withVerification,
} from './helpers.js';

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

const AGENT_ID = 'agent-ph-1';

async function setupWorld() {
  const s = bootServer({ claimHoldMs: 200 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-ph',
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
      displayName: 'ph-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'ph-mbp', cliVersion: '0.1.0' },
  });

  bindAllAgents(s);
  const { token } = (await enrollRes.json()) as { token: string };
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '探针任务', spec: '写一行探针到 README.md' },
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
    const body = (await res.json()) as { builds: { id: string }[] };
    return body.builds[0]!.id;
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
  async function tryUploadPlan(stepId: string, content: string): Promise<Response> {
    const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      cred: token,
      body: { files: [{ name: PLAN_FILE_NAME }] },
    });
    const urls = machineUploadUrlsResponseSchema.parse(await urlsRes.json());
    const up = urls.uploads[0]!;
    return call(s.app, 'PUT', up.url.replace(/^https?:\/\/[^/]+/, ''), {
      cred: token,
      text: content,
      contentType: 'text/markdown',
    });
  }
  const todoRow = () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
  const stepsOf = (buildId: string) =>
    s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
  const plansOf = (buildId: string) =>
    s.db.select().from(planTable).where(eq(planTable.buildId, buildId)).all();
  const buildRowOf = (buildId: string) =>
    s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
  return {
    s,
    token,
    projectId,
    todoId,
    startBuild,
    claim,
    done,
    uploadPlan,
    tryUploadPlan,
    todoRow,
    stepsOf,
    plansOf,
    buildRowOf,
  };
}

type World = Awaited<ReturnType<typeof setupWorld>>;

async function confirm(w: World, buildId: string): Promise<void> {
  const res = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
    body: { action: 'confirm' },
  });
  expect(res.status).toBe(202);
}

describe('the plan-gate deliverable check (#113 candidate 1: the plan is the file plan.md, 02 §4.2)', () => {
  test('the plan step produced no plan.md -> does not reach confirm: stays planning + an automatic backfill step queued (with the backfill instruction)', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      expect(planStep.step.kind).toBe('plan');
      expect(planStep.session.action).toBe('new');
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('planning');
      const pending = w
        .stepsOf(buildId)
        .filter((st) => st.kind === 'plan' && st.status === 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0]!.prompt).toContain(PLAN_FILE_NAME);
      expect(w.todoRow().hasPlan).toBe(false);
    } finally {
      w.s.dispose();
    }
  });

  test('the backfill round still has no plan.md -> #703 gate 1 closes as failed (confirm unreachable, no more free pass)', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      const rewrite = await w.claim();
      expect(rewrite.step.kind).toBe('plan');
      expect(rewrite.session).toEqual({ action: 'continue', sessionId: 'pi-1' });
      expect(rewrite.instruction).toContain(PLAN_FILE_NAME);
      await w.done(rewrite.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('failed');
      expect(w.stepsOf(buildId).filter((st) => st.kind === 'plan')).toHaveLength(2);
      expect(w.todoRow().hasPlan).toBe(false);
    } finally {
      w.s.dispose();
    }
  });

  test('no regression on the normal path: the plan.md deliverable present -> confirm + hasPlan set (no backfill step)', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案\nContext: x'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.todoRow().hasPlan).toBe(true);
      expect(w.stepsOf(buildId).filter((st) => st.kind === 'plan')).toHaveLength(1);
    } finally {
      w.s.dispose();
    }
  });

  test('a reject-and-replan round that produced no new plan.md -> straight to confirm (the automatic backfill does not stack another instruction step)', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# v1'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      const rev = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
        body: {
          action: 'revision',
          side: 'plan',
          feedback: '标题去掉项目名后缀',
          clientMessageId: '3f9a0c2e-0000-4000-8000-000000000002',
        },
      });
      expect(rev.status).toBe(202);
      expect(w.todoRow().phase).toBe('planning');
      const replan = await w.claim();
      expect(replan.step.kind).toBe('plan');
      await w.done(replan.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.stepsOf(buildId).filter((st) => st.kind === 'plan')).toHaveLength(2);
    } finally {
      w.s.dispose();
    }
  });
});

describe('the build step spec fallback (#113 candidate 2: deliverable still missing -> forced new session)', () => {
  test('plan.md absent at confirm (a leftover state from the upgrade window) -> the build step claim = new session + the todo original spec in the payload', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      w.s.db.update(buildTable).set({ planDocId: null }).where(eq(buildTable.id, buildId)).run();
      await confirm(w, buildId);
      const buildStep = await w.claim();
      expect(buildStep.step.kind).toBe('build');
      expect(buildStep.session).toEqual({ action: 'new', sessionId: null });
      expect(buildStep.todo).toMatchObject({
        title: '探针任务',
        spec: '写一行探针到 README.md',
      });
    } finally {
      w.s.dispose();
    }
  });

  test('plan.md present -> the build step continue session unchanged (no regression on the normal path)', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案\nContext: x'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      await confirm(w, buildId);
      const buildStep = await w.claim();
      expect(buildStep.step.kind).toBe('build');
      expect(buildStep.session).toEqual({ action: 'continue', sessionId: 'pi-1' });
    } finally {
      w.s.dispose();
    }
  });

  test('withPlan=false direct execution unaffected (planDocId always null, never mistaken for a missing deliverable)', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(false);
      const buildStep = await w.claim();
      expect(buildStep.step.kind).toBe('build');
      expect(buildStep.session).toEqual({ action: 'new', sessionId: null });
      expect(w.todoRow().phase).toBe('building');
    } finally {
      w.s.dispose();
    }
  });
});

describe('XMON-59: the upload seam emits events + done replay is idempotent (the phase funnel silently dropping events)', () => {
  test('plan.md emits a conversation stream step event the moment it is stored (no done involved, the subscription precedes the upload)', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const claimed = await w.claim();
      const stream = await openConvStream(w.s.app, buildId);
      try {
        await w.uploadPlan(claimed.step.id, withVerification('# 方案 v1'));
        const raw = await stream.next((ev) => ev.type === 'step', 3000);
        const ev = conversationStreamEventSchema.parse(raw);
        if (ev.type !== 'step') throw new Error(`expected step event, got ${ev.type}`);
        expect(ev.step).toMatchObject({ id: claimed.step.id, buildId, status: 'claimed' });
      } finally {
        stream.close();
      }
    } finally {
      w.s.dispose();
    }
  });

  test('done replay (recover surface) is same-phase idempotent: no 500, the replay has zero side effects (v/phaseAt unchanged)', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(true);
      const claimed = await w.claim();
      await w.uploadPlan(claimed.step.id, withVerification('# 方案 v1'));
      await w.done(claimed.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.todoRow().hasPlan).toBe(true);
      const before = w.todoRow();
      await w.done(claimed.step.id, { status: 'success', sessionId: 'pi-1' });
      const after = w.todoRow();
      expect(after.v).toBe(before.v);
      expect(after.phaseAt).toBe(before.phaseAt);
      expect(after.phase).toBe('confirm');
    } finally {
      w.s.dispose();
    }
  });
});

describe('#1026/#1027 the plan upload receiving end: input validation + step-and-content idempotency', () => {
  test('a build step PUT plan.md -> rejected 400: no version stored, planDocId unchanged (the #1027 rejection leg)', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      expect(buildStep.step.kind).toBe('build');
      const res = await w.tryUploadPlan(buildStep.step.id, '# 伪方案');
      expect(res.status).toBe(400);
      expect(Object.keys((await res.json()) as object)).toEqual(['error']);
      expect(w.plansOf(buildId)).toHaveLength(0);
      expect(w.buildRowOf(buildId).planDocId).toBeNull();
    } finally {
      w.s.dispose();
    }
  });

  test('a review step PUT plan.md -> rejected 400: no version stored, planDocId unchanged (the #1027 rejection leg)', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      await confirm(w, buildId);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, { status: 'success', sessionId: 'pi-1', hasChanges: true });
      const revRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
        body: { action: 'review', agentId: AGENT_ID },
      });
      expect(revRes.status).toBe(202);
      const reviewStep = await w.claim();
      expect(reviewStep.step.kind).toBe('review');
      const res = await w.tryUploadPlan(reviewStep.step.id, '# 伪方案');
      expect(res.status).toBe(400);
      expect(Object.keys((await res.json()) as object)).toEqual(['error']);
      expect(w.plansOf(buildId)).toHaveLength(1);
      expect(w.buildRowOf(buildId).planDocId).toBe(w.plansOf(buildId)[0]!.id);
    } finally {
      w.s.dispose();
    }
  });

  test('a late PUT after the step is done -> rejected 409: the plan table untouched (the #1027 state leg)', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      const res = await w.tryUploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      expect(res.status).toBe(409);
      expect(w.plansOf(buildId)).toHaveLength(1);
      expect(w.buildRowOf(buildId).planDocId).toBe(w.plansOf(buildId)[0]!.id);
    } finally {
      w.s.dispose();
    }
  });

  test('a repeated same-content PUT in the same tick -> idempotent: no duplicate version, planDocId does not drift (#1026)', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      const plans = w.plansOf(buildId);
      expect(plans).toHaveLength(1);
      expect(plans[0]!.version).toBe(1);
      expect(plans[0]!.content).toBe(withVerification('# 方案 v1'));
      expect(w.buildRowOf(buildId).planDocId).toBe(plans[0]!.id);
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.todoRow().hasPlan).toBe(true);
    } finally {
      w.s.dispose();
    }
  });

  test('the content really changed -> a new version lands as usual (idempotent is not never-add, the #1026 positive leg)', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v2（改稿）'));
      const plans = w.plansOf(buildId);
      expect(plans.map((p) => p.version)).toEqual([1, 2]);
      expect(w.buildRowOf(buildId).planDocId).toBe(plans[1]!.id);
    } finally {
      w.s.dispose();
    }
  });

  test('the same text re-planned in another step -> a new version still lands (idempotency key = step + content; the reject-round v2 semantics do not regress)', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      const rev = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
        body: {
          action: 'revision',
          side: 'plan',
          feedback: '再看看',
          clientMessageId: '3f9a0c2e-0000-4000-8000-0000000000aa',
        },
      });
      expect(rev.status).toBe(202);
      const replan = await w.claim();
      expect(replan.step.id).not.toBe(planStep.step.id);
      await w.uploadPlan(replan.step.id, withVerification('# 方案 v1'));
      const plans = w.plansOf(buildId);
      expect(plans.map((p) => p.version)).toEqual([1, 2]);
      expect(plans[1]!.content).toBe(withVerification('# 方案 v1'));
      expect(w.buildRowOf(buildId).planDocId).toBe(plans[1]!.id);
    } finally {
      w.s.dispose();
    }
  });
});
