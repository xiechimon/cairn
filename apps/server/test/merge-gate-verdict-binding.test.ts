import { claimedStepSchema, parseReviewPromptMeta, parseVerifyPromptMeta } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  gateVerdict,
  provider as providerTable,
  step as stepTable,
} from '../src/db/schema.js';
import { ensurePersonasSeeded } from '../src/services/personas.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  withVerification,
} from './helpers.js';

const HEAD = 'ab'.repeat(20);
const BUILDER_ID = 'agent-gate-builder';
const REVIEWER_ID = 'agent-gate-reviewer';

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

async function setup() {
  const s = bootServer({ claimHoldMs: 200, pingIntervalMs: 3_600_000 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-gate-verdict',
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
  ensurePersonasSeeded(s.db, s.team.id);
  s.db
    .insert(agentTable)
    .values({
      id: BUILDER_ID,
      teamId: s.team.id,
      displayName: 'gate-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: REVIEWER_ID,
      teamId: s.team.id,
      displayName: 'gate-reviewer',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'gate-mbp', cliVersion: '0.1.0' },
  });
  expect(enrollRes.status).toBe(200);
  const { token: machineToken } = (await enrollRes.json()) as { token: string };
  bindAllAgents(s);
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '判定绑定探针', spec: 'S5a' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };

  async function startBuild(assignment: Record<string, unknown>, withPlan = false) {
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: { todoIds: [todoId], assignment, withPlan },
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
  }
  async function claim() {
    const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: machineToken,
      body: {},
    });
    const body = (await res.json()) as { step?: unknown };
    if (!body.step) throw new Error('claim returned no step');
    const parsed = claimedStepSchema.parse(body.step);
    return { stepId: parsed.step.id, kind: parsed.step.kind };
  }
  async function done(stepId: string, body: Record<string, unknown>) {
    const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: machineToken,
      body,
    });
    expect(res.status).toBe(200);
  }
  async function uploadPlan(stepId: string, content: string) {
    const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      cred: machineToken,
      body: { files: [{ name: 'plan.md' }] },
    });
    const urls = (await urlsRes.json()) as { uploads: { url: string }[] };
    const up = urls.uploads[0]!;
    const put = await call(s.app, 'PUT', up.url.replace(/^https?:\/\/[^/]+/, ''), {
      cred: machineToken,
      text: content,
      contentType: 'text/markdown',
    });
    expect(put.status).toBe(200);
  }

  return {
    s,
    todoId,
    projectId,
    startBuild,
    claim,
    done,
    uploadPlan,
    stepsOf: (buildId: string) =>
      s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all(),
    verdictOf: (stepId: string) =>
      s.db.select().from(gateVerdict).where(eq(gateVerdict.stepId, stepId)).get(),
  };
}

type World = Awaited<ReturnType<typeof setup>>;

let world: World | undefined;
afterEach(() => {
  world?.s.dispose();
  world = undefined;
});

async function reachReviewGate(w: World, assignment: Record<string, unknown>): Promise<string> {
  const buildId = await w.startBuild(assignment, false);
  const claimed = await w.claim();
  expect(claimed.kind).toBe('build');
  await w.done(claimed.stepId, { status: 'success', hasChanges: true, commit: HEAD });
  return buildId;
}

describe('#1404 S5a 判定绑定', () => {
  test('审核关口派步的 meta 写 expectedHeadSha；抽取失败入库为 extraction_failed 并能读回', async () => {
    world = await setup();
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    const reviewRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review', agentId: REVIEWER_ID },
    });
    expect(reviewRes.status).toBe(202);
    const reviewStep = w.stepsOf(buildId).find((r) => r.kind === 'review');
    expect(reviewStep).toBeDefined();
    const meta = parseReviewPromptMeta(reviewStep?.prompt ?? null);
    expect(meta?.expectedHeadSha).toBe(HEAD);

    const claimed = await w.claim();
    expect(claimed.kind).toBe('review');
    await w.done(claimed.stepId, {
      status: 'success',
      findingsError: '审核步输出中未找到 verdict JSON',
    });

    const row = w.verdictOf(claimed.stepId);
    expect(row).toBeDefined();
    expect(row?.outcome).toBe('extraction_failed');
    expect(row?.outcome).not.toBe('pass');
    expect(row?.expectedHeadSha).toBe(HEAD);
    expect(row?.kind).toBe('review');
    expect(row?.buildId).toBe(buildId);
  });

  test('verify 抽取失败入库为 extraction_failed，expectedHeadSha 能从库读回', async () => {
    world = await setup();
    const w = world;
    const verifierId =
      w.s.db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(eq(agentTable.persona, 'verifier'))
        .get()?.id ?? '';
    expect(verifierId).not.toBe('');
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
      verify: { agentId: verifierId },
    });
    const verifyStep = w.stepsOf(buildId).find((r) => r.kind === 'verify');
    expect(verifyStep).toBeDefined();
    const meta = parseVerifyPromptMeta(verifyStep?.prompt ?? null);
    expect(meta?.expectedHeadSha).toBe(HEAD);
    expect(verifyStep?.prompt ?? '').toContain('代码只读');

    const claimed = await w.claim();
    expect(claimed.kind).toBe('verify');
    await w.done(claimed.stepId, {
      status: 'success',
      verifyVerdictError: '验证步输出中未找到 verdict JSON',
    });

    const row = w.verdictOf(claimed.stepId);
    expect(row).toBeDefined();
    expect(row?.outcome).toBe('extraction_failed');
    expect(row?.outcome).not.toBe('pass');
    expect(row?.expectedHeadSha).toBe(HEAD);
    expect(row?.kind).toBe('verify');
  });

  test('抽出的通过判定入库为 pass，带 expectedHeadSha', async () => {
    world = await setup();
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review', agentId: REVIEWER_ID },
    });
    const claimed = await w.claim();
    await w.done(claimed.stepId, {
      status: 'success',
      commit: HEAD,
      findings: { conclusion: '通过', findings: [] },
    });
    const row = w.verdictOf(claimed.stepId);
    expect(row?.outcome).toBe('pass');
    expect(row?.expectedHeadSha).toBe(HEAD);
    expect(row?.headSha).toBe(HEAD);
  });

  test('确认关口没有代码 head 时不写 gate_verdict', async () => {
    world = await setup();
    const w = world;
    const buildId = await w.startBuild(
      { plan: { agentId: BUILDER_ID }, build: { agentId: BUILDER_ID } },
      true,
    );
    const planClaimed = await w.claim();
    expect(planClaimed.kind).toBe('plan');
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan'));
    await w.done(planClaimed.stepId, { status: 'success' });
    const reviewRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review', agentId: REVIEWER_ID },
    });
    expect(reviewRes.status).toBe(202);
    const reviewStep = w.stepsOf(buildId).find((r) => r.kind === 'review');
    expect(parseReviewPromptMeta(reviewStep?.prompt ?? null)?.expectedHeadSha).toBeUndefined();
    const claimed = await w.claim();
    await w.done(claimed.stepId, {
      status: 'success',
      findingsError: '审核步输出中未找到 verdict JSON',
    });
    expect(w.verdictOf(claimed.stepId)).toBeUndefined();
  });
});
