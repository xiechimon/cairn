import {
  claimedStepSchema,
  GATE_LIMITS,
  parseReviewPromptMeta,
  parseVerifyPromptMeta,
  REVIEW_FANOUT_ROLES,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  gateVerdict,
  project as projectTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { flushVerdictDigests } from '../src/services/builds.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { compareFilesFromResponse, computePatchDigest } from '../src/services/merge-gate/digest.js';
import { ensurePersonasSeeded } from '../src/services/personas.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  withVerification,
} from './helpers.js';

const HEAD = 'ab'.repeat(20);
const BASE = '11'.repeat(20);
const EVIDENCE = 'cd'.repeat(20);
const OTHER = 'ef'.repeat(20);
const BLOB = '99'.repeat(20);
const PR = 7;
const TOKEN = 'ghs_test_token';
const BUILDER_ID = 'agent-gate-builder';
const REVIEWER_ID = 'agent-gate-reviewer';

const DELIVERY_FILE = {
  filename: 'apps/server/src/a.ts',
  status: 'modified',
  sha: BLOB,
  additions: 2,
  deletions: 1,
  changes: 3,
  patch: '@@ -1 +1 @@\n-a\n+b\n',
};

function ghJson(body: unknown) {
  return {
    ok: true as const,
    status: 200,
    headers: { get: () => null as string | null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function comparePayload(head: string, parent: string, files: unknown[]) {
  return {
    files,
    total_commits: 1,
    commits: [{ sha: head, parents: [{ sha: parent }] }],
    behind_by: 0,
  };
}

function deliveryCompare() {
  return comparePayload(HEAD, BASE, [DELIVERY_FILE]);
}

function deliveryDigest(): string {
  const digest = computePatchDigest(compareFilesFromResponse(deliveryCompare()) ?? []).patchDigest;
  if (digest === null) throw new Error('fixture digest unavailable');
  return digest;
}

function evidenceFile(ticket: string, name = 'notes.md', previous?: string) {
  return {
    filename: `docs/verify/${ticket}/${name}`,
    status: previous === undefined ? 'added' : 'renamed',
    ...(previous === undefined ? {} : { previous_filename: previous }),
    sha: '98'.repeat(20),
    additions: 3,
    deletions: 0,
    changes: 3,
    patch: '@@ -0,0 +1,3 @@\n+a\n+b\n+c\n',
  };
}

function scriptedGithub(ranges: Record<string, unknown>): FetchLike {
  return async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith(`/pulls/${PR}`)) {
      return ghJson({
        number: PR,
        state: 'open',
        merged: false,
        base: { sha: BASE, ref: 'main' },
        head: { sha: HEAD },
      });
    }
    const marker = '/compare/';
    const at = path.indexOf(marker);
    if (at !== -1) {
      const spec = decodeURIComponent(path.slice(at + marker.length));
      const body = ranges[spec];
      if (body !== undefined) return ghJson(body);
    }
    return {
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({ message: 'missing' }),
      text: async () => '{"message":"missing"}',
    };
  };
}

function ticketOf(w: World): string {
  const seq = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.seqNum;
  if (seq === undefined) throw new Error('todo missing');
  return String(seq);
}

function attachGithubRepo(w: World, buildId: string) {
  w.s.db
    .update(projectTable)
    .set({ repoKind: 'github', githubRepo: 'octo/demo' })
    .where(eq(projectTable.id, w.projectId))
    .run();
  w.s.db
    .update(buildTable)
    .set({ prNumber: PR, prUrl: `https://github.com/octo/demo/pull/${PR}` })
    .where(eq(buildTable.id, buildId))
    .run();
  upsertGithubConnection(
    { db: w.s.db, box: w.s.secretBox },
    { teamId: w.s.team.id, login: 'octo', accessToken: TOKEN, scope: 'repo' },
  );
}

const PASS_FINDINGS = { conclusion: '通过', findings: [] as [] };

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

async function setup(opts: { githubFetch?: FetchLike } = {}) {
  const s = bootServer({
    claimHoldMs: 200,
    pingIntervalMs: 3_600_000,
    ...(opts.githubFetch !== undefined ? { githubFetch: opts.githubFetch } : {}),
  });
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

  return {
    s,
    machineToken,
    todoId,
    projectId,
    async startBuild(assignment: Record<string, unknown>, withPlan = false) {
      const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: { todoIds: [todoId], assignment, withPlan },
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
    },
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: machineToken,
        body: {},
      });
      const body = (await res.json()) as { step?: unknown };
      if (!body.step) throw new Error('claim returned no step');
      const parsed = claimedStepSchema.parse(body.step);
      return { stepId: parsed.step.id, kind: parsed.step.kind };
    },
    async done(stepId: string, body: Record<string, unknown>) {
      const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: machineToken,
        body,
      });
      expect(res.status).toBe(200);
    },
    stepsOf: (buildId: string) =>
      s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all(),
    verdictOf: (stepId: string) =>
      s.db.select().from(gateVerdict).where(eq(gateVerdict.stepId, stepId)).get(),
  };
}

type World = Awaited<ReturnType<typeof setup>>;

let world: World | undefined;
let releaseHungGithub: (() => void) | undefined;
afterEach(async () => {
  releaseHungGithub?.();
  releaseHungGithub = undefined;
  await flushVerdictDigests();
  world?.s.dispose();
  world = undefined;
});

const unreachableGithub: FetchLike = async () => {
  throw new Error('getaddrinfo ENOTFOUND api.github.com');
};

async function reachReviewGate(w: World, assignment: Record<string, unknown>): Promise<string> {
  const buildId = await w.startBuild(assignment, false);
  const claimed = await w.claim();
  expect(claimed.kind).toBe('build');
  await w.done(claimed.stepId, { status: 'success', hasChanges: true, commit: HEAD });
  return buildId;
}

async function claimReview(w: World, buildId: string): Promise<string> {
  const reviewRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
    body: { action: 'review', agentId: REVIEWER_ID },
  });
  expect(reviewRes.status).toBe(202);
  const claimed = await w.claim();
  expect(claimed.kind).toBe('review');
  return claimed.stepId;
}

async function reachVerify(w: World): Promise<string> {
  const verifierId =
    w.s.db
      .select({ id: agentTable.id })
      .from(agentTable)
      .where(eq(agentTable.persona, 'verifier'))
      .get()?.id ?? '';
  expect(verifierId).not.toBe('');
  return reachReviewGate(w, {
    plan: { agentId: BUILDER_ID },
    build: { agentId: BUILDER_ID },
    verify: { agentId: verifierId },
  });
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
    expect(row?.headSha).toBe(HEAD);
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
    expect(row?.headSha).toBeNull();
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
      findings: PASS_FINDINGS,
    });
    const row = w.verdictOf(claimed.stepId);
    expect(row?.outcome).toBe('pass');
    expect(row?.expectedHeadSha).toBe(HEAD);
    expect(row?.headSha).toBe(HEAD);
    expect(row?.patchDigest).toBeNull();
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
    const urlsRes = await call(w.s.app, 'POST', `/api/machine/upload-urls/${planClaimed.stepId}`, {
      cred: w.machineToken,
      body: { files: [{ name: 'plan.md' }] },
    });
    const urls = (await urlsRes.json()) as { uploads: { url: string }[] };
    const up = urls.uploads[0]!;
    const put = await call(w.s.app, 'PUT', up.url.replace(/^https?:\/\/[^/]+/, ''), {
      cred: w.machineToken,
      text: withVerification('# plan'),
      contentType: 'text/markdown',
    });
    expect(put.status).toBe(200);
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

  test('最近一条 checkpoint 不是小写 SHA 时，派步仍绑上一条交付 SHA', async () => {
    world = await setup();
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    const buildStep = w.stepsOf(buildId).find((r) => r.kind === 'build' && r.status === 'done');
    expect(buildStep?.checkpointCommit).toBe(HEAD);
    expect(buildStep?.finishedAt).toEqual(expect.any(Number));
    const later = (buildStep?.finishedAt ?? 0) + 1_000;
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-upper-head',
        buildId,
        kind: 'build',
        status: 'done',
        checkpointCommit: HEAD.toUpperCase(),
        createdAt: later,
        finishedAt: later,
      })
      .run();
    const stepId = await claimReview(w, buildId);
    const meta = parseReviewPromptMeta(
      w.stepsOf(buildId).find((r) => r.id === stepId)?.prompt ?? null,
    );
    expect(meta?.expectedHeadSha).toBe(HEAD);
  });

  test('审核 blocking 入库为 block，不报 commit 也绑 expectedHeadSha', async () => {
    world = await setup();
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    const stepId = await claimReview(w, buildId);
    await w.done(stepId, {
      status: 'success',
      findings: {
        conclusion: '要改',
        findings: [{ id: '1', severity: 'blocking', summary: '缺测试' }],
      },
    });
    const row = w.verdictOf(stepId);
    expect(row?.outcome).toBe('block');
    expect(row?.headSha).toBe(HEAD);
    expect(row?.expectedHeadSha).toBe(HEAD);
  });

  test('审核步失败走收尾入库为 step_failed，head 用 expectedHeadSha', async () => {
    world = await setup();
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    const stepId = await claimReview(w, buildId);
    await w.done(stepId, { status: 'failed', errorMessage: '审核进程退出' });
    const row = w.verdictOf(stepId);
    expect(row?.outcome).toBe('step_failed');
    expect(row?.headSha).toBe(HEAD);
    expect(row?.expectedHeadSha).toBe(HEAD);
  });

  test('verify 通过入库为 pass，没报 head 时 headSha 为空', async () => {
    world = await setup();
    const w = world;
    await reachVerify(w);
    const claimed = await w.claim();
    expect(claimed.kind).toBe('verify');
    await w.done(claimed.stepId, {
      status: 'success',
      verifyVerdict: { passed: true, conclusion: '过了', evidence: [] },
    });
    expect(w.verdictOf(claimed.stepId)?.outcome).toBe('pass');
    expect(w.verdictOf(claimed.stepId)?.headSha).toBeNull();
  });

  test('verify 未通过入库为 block，没报 head 时 headSha 为空', async () => {
    world = await setup();
    const w = world;
    await reachVerify(w);
    const claimed = await w.claim();
    expect(claimed.kind).toBe('verify');
    await w.done(claimed.stepId, {
      status: 'success',
      verifyVerdict: { passed: false, conclusion: '没过', evidence: [] },
    });
    expect(w.verdictOf(claimed.stepId)?.outcome).toBe('block');
    expect(w.verdictOf(claimed.stepId)?.headSha).toBeNull();
  });

  test('head 一致时按 GitHub compare 把交付摘要写入判定', async () => {
    const ranges: Record<string, unknown> = { [`${BASE}...${HEAD}`]: deliveryCompare() };
    world = await setup({ githubFetch: scriptedGithub(ranges) });
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    attachGithubRepo(w, buildId);
    const stepId = await claimReview(w, buildId);
    await w.done(stepId, { status: 'success', findings: PASS_FINDINGS });
    await flushVerdictDigests();
    const row = w.verdictOf(stepId);
    expect(row?.headSha).toBe(HEAD);
    expect(row?.patchDigest).toBe(deliveryDigest());
  });

  test('verify 只在证据目录追加提交时，摘要绑派步时的交付 head', async () => {
    const ranges: Record<string, unknown> = { [`${BASE}...${HEAD}`]: deliveryCompare() };
    world = await setup({ githubFetch: scriptedGithub(ranges) });
    const w = world;
    const ticket = ticketOf(w);
    ranges[`${HEAD}...${EVIDENCE}`] = comparePayload(EVIDENCE, HEAD, [evidenceFile(ticket)]);
    const buildId = await reachVerify(w);
    attachGithubRepo(w, buildId);
    const claimed = await w.claim();
    expect(claimed.kind).toBe('verify');
    await w.done(claimed.stepId, {
      status: 'success',
      commit: EVIDENCE,
      verifyVerdict: { passed: true, conclusion: '过了', evidence: [] },
    });
    await flushVerdictDigests();
    const row = w.verdictOf(claimed.stepId);
    expect(row?.outcome).toBe('pass');
    expect(row?.headSha).toBe(EVIDENCE);
    expect(row?.expectedHeadSha).toBe(HEAD);
    expect(row?.patchDigest).toBe(deliveryDigest());
  });

  test('verify 的后续提交改了代码时，摘要不绑定', async () => {
    const ranges: Record<string, unknown> = { [`${BASE}...${HEAD}`]: deliveryCompare() };
    world = await setup({ githubFetch: scriptedGithub(ranges) });
    const w = world;
    const ticket = ticketOf(w);
    ranges[`${HEAD}...${EVIDENCE}`] = comparePayload(EVIDENCE, HEAD, [
      evidenceFile(ticket),
      DELIVERY_FILE,
    ]);
    const buildId = await reachVerify(w);
    attachGithubRepo(w, buildId);
    const claimed = await w.claim();
    await w.done(claimed.stepId, {
      status: 'success',
      commit: EVIDENCE,
      verifyVerdict: { passed: true, conclusion: '过了', evidence: [] },
    });
    expect(w.verdictOf(claimed.stepId)?.headSha).toBe(EVIDENCE);
    expect(w.verdictOf(claimed.stepId)?.patchDigest).toBeNull();
  });

  test('verify 把代码改名进证据目录时，摘要不绑定', async () => {
    const ranges: Record<string, unknown> = { [`${BASE}...${HEAD}`]: deliveryCompare() };
    world = await setup({ githubFetch: scriptedGithub(ranges) });
    const w = world;
    const ticket = ticketOf(w);
    ranges[`${HEAD}...${OTHER}`] = comparePayload(OTHER, HEAD, [
      evidenceFile(ticket, 'x.ts', 'apps/server/src/x.ts'),
    ]);
    const buildId = await reachVerify(w);
    attachGithubRepo(w, buildId);
    const claimed = await w.claim();
    await w.done(claimed.stepId, {
      status: 'success',
      commit: OTHER,
      verifyVerdict: { passed: false, conclusion: '没过', evidence: [] },
    });
    expect(w.verdictOf(claimed.stepId)?.outcome).toBe('block');
    expect(w.verdictOf(claimed.stepId)?.headSha).toBe(OTHER);
    expect(w.verdictOf(claimed.stepId)?.patchDigest).toBeNull();
  });

  test('证据目录的 compare 顶满文件上限时不把没读全的列表当成只改了证据', async () => {
    const ranges: Record<string, unknown> = { [`${BASE}...${HEAD}`]: deliveryCompare() };
    world = await setup({ githubFetch: scriptedGithub(ranges) });
    const w = world;
    const ticket = ticketOf(w);
    ranges[`${HEAD}...${EVIDENCE}`] = comparePayload(
      EVIDENCE,
      HEAD,
      Array.from({ length: GATE_LIMITS.compareFileCap }, (_, i) =>
        evidenceFile(ticket, `f${i}.txt`),
      ),
    );
    const buildId = await reachVerify(w);
    attachGithubRepo(w, buildId);
    const claimed = await w.claim();
    await w.done(claimed.stepId, {
      status: 'success',
      commit: EVIDENCE,
      verifyVerdict: { passed: true, conclusion: '过了', evidence: [] },
    });
    expect(w.verdictOf(claimed.stepId)?.headSha).toBe(EVIDENCE);
    expect(w.verdictOf(claimed.stepId)?.patchDigest).toBeNull();
  });

  test('gateHeadSha 是另一枚 SHA 时记下它，不拿 expected 顶上', async () => {
    world = await setup();
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    const stepId = await claimReview(w, buildId);
    await w.done(stepId, {
      status: 'success',
      gateHeadSha: OTHER,
      findings: PASS_FINDINGS,
    });
    const row = w.verdictOf(stepId);
    expect(row?.headSha).toBe(OTHER);
    expect(row?.patchDigest).toBeNull();
  });

  test('gateHeadSha 不是闸认的 SHA 时忽略，审核仍绑 expectedHeadSha', async () => {
    world = await setup();
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    const stepId = await claimReview(w, buildId);
    await w.done(stepId, {
      status: 'success',
      gateHeadSha: 'HEAD',
      findings: PASS_FINDINGS,
    });
    expect(w.verdictOf(stepId)?.headSha).toBe(HEAD);
  });

  test('gateHeadSha 等于 expected 但 commit 是后来的代码提交时，摘要不绑定', async () => {
    const ranges: Record<string, unknown> = {
      [`${BASE}...${HEAD}`]: deliveryCompare(),
      [`${HEAD}...${OTHER}`]: comparePayload(OTHER, HEAD, [DELIVERY_FILE]),
    };
    world = await setup({ githubFetch: scriptedGithub(ranges) });
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    attachGithubRepo(w, buildId);
    const stepId = await claimReview(w, buildId);
    await w.done(stepId, {
      status: 'success',
      gateHeadSha: HEAD,
      commit: OTHER,
      findings: PASS_FINDINGS,
    });
    const row = w.verdictOf(stepId);
    expect(row?.headSha).toBe(OTHER);
    expect(row?.patchDigest).toBeNull();
  });

  test('三视角 fan-out 各写一条判定，perspective 是各自的角色', async () => {
    world = await setup();
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    const reviewRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review' },
    });
    expect(reviewRes.status).toBe(202);
    const stepIds: string[] = [];
    for (const _ of REVIEW_FANOUT_ROLES) {
      const claimed = await w.claim();
      expect(claimed.kind).toBe('review');
      stepIds.push(claimed.stepId);
    }
    for (const stepId of stepIds) {
      await w.done(stepId, { status: 'success', findings: PASS_FINDINGS });
    }
    const perspectives = stepIds.map((id) => w.verdictOf(id)?.perspective).sort();
    expect(perspectives).toEqual([...REVIEW_FANOUT_ROLES].sort());
  });

  test('同一步的判定已入库时再收尾不抛错，保留先写的那条', async () => {
    world = await setup();
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    const stepId = await claimReview(w, buildId);
    w.s.db
      .insert(gateVerdict)
      .values({
        stepId,
        buildId,
        kind: 'review',
        perspective: null,
        outcome: 'block',
        patchDigest: null,
        headSha: HEAD,
        expectedHeadSha: HEAD,
        createdAt: 1,
      })
      .run();
    await w.done(stepId, { status: 'success', findings: PASS_FINDINGS });
    expect(w.verdictOf(stepId)?.outcome).toBe('block');
    expect(w.verdictOf(stepId)?.createdAt).toBe(1);
  });

  test('GitHub 挂住时 /done 不等它，判定照样入库、摘要留空', async () => {
    const released = new Promise<void>((resolve) => {
      releaseHungGithub = resolve;
    });
    world = await setup({
      githubFetch: async (_input, init) => {
        const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(new Error('aborted'));
          signal?.addEventListener('abort', abort, { once: true });
          void released.then(abort);
        });
        throw new Error('unreachable');
      },
    });
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    attachGithubRepo(w, buildId);
    const stepId = await claimReview(w, buildId);
    const started = Date.now();
    await w.done(stepId, { status: 'success', findings: PASS_FINDINGS });
    expect(Date.now() - started).toBeLessThan(2_000);
    const row = w.verdictOf(stepId);
    expect(row?.outcome).toBe('pass');
    expect(row?.headSha).toBe(HEAD);
    expect(row?.patchDigest).toBeNull();
    releaseHungGithub?.();
    await flushVerdictDigests();
    expect(w.verdictOf(stepId)?.patchDigest).toBeNull();
  });

  test('GitHub 不可达时摘要保持未绑定', async () => {
    world = await setup({ githubFetch: unreachableGithub });
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    attachGithubRepo(w, buildId);
    const stepId = await claimReview(w, buildId);
    await w.done(stepId, { status: 'success', findings: PASS_FINDINGS });
    await flushVerdictDigests();
    const row = w.verdictOf(stepId);
    expect(row?.outcome).toBe('pass');
    expect(row?.headSha).toBe(HEAD);
    expect(row?.patchDigest).toBeNull();
  });

  test('verify 报了两个漂移 head 时取后报的 commit，GitHub 不可达也一样', async () => {
    world = await setup({ githubFetch: unreachableGithub });
    const w = world;
    const buildId = await reachVerify(w);
    attachGithubRepo(w, buildId);
    const claimed = await w.claim();
    expect(claimed.kind).toBe('verify');
    await w.done(claimed.stepId, {
      status: 'success',
      gateHeadSha: OTHER,
      commit: EVIDENCE,
      verifyVerdict: { passed: true, conclusion: '过了', evidence: [] },
    });
    await flushVerdictDigests();
    expect(w.verdictOf(claimed.stepId)?.headSha).toBe(EVIDENCE);
    expect(w.verdictOf(claimed.stepId)?.patchDigest).toBeNull();
  });

  test('verify 报了两个漂移 head、都只碰证据目录时，摘要绑交付 head', async () => {
    const ranges: Record<string, unknown> = { [`${BASE}...${HEAD}`]: deliveryCompare() };
    world = await setup({ githubFetch: scriptedGithub(ranges) });
    const w = world;
    const ticket = ticketOf(w);
    ranges[`${HEAD}...${OTHER}`] = comparePayload(OTHER, HEAD, [evidenceFile(ticket, 'a.md')]);
    ranges[`${HEAD}...${EVIDENCE}`] = comparePayload(EVIDENCE, OTHER, [
      evidenceFile(ticket, 'a.md'),
      evidenceFile(ticket, 'b.md'),
    ]);
    const buildId = await reachVerify(w);
    attachGithubRepo(w, buildId);
    const claimed = await w.claim();
    await w.done(claimed.stepId, {
      status: 'success',
      gateHeadSha: OTHER,
      commit: EVIDENCE,
      verifyVerdict: { passed: true, conclusion: '过了', evidence: [] },
    });
    await flushVerdictDigests();
    expect(w.verdictOf(claimed.stepId)?.headSha).toBe(EVIDENCE);
    expect(w.verdictOf(claimed.stepId)?.patchDigest).toBe(deliveryDigest());
  });

  test('verify 步失败时判定记下证据提交的 head，只碰证据目录的漂移仍绑交付摘要', async () => {
    const ranges: Record<string, unknown> = { [`${BASE}...${HEAD}`]: deliveryCompare() };
    world = await setup({ githubFetch: scriptedGithub(ranges) });
    const w = world;
    const ticket = ticketOf(w);
    ranges[`${HEAD}...${EVIDENCE}`] = comparePayload(EVIDENCE, HEAD, [evidenceFile(ticket)]);
    const buildId = await reachVerify(w);
    attachGithubRepo(w, buildId);
    const claimed = await w.claim();
    await w.done(claimed.stepId, {
      status: 'failed',
      errorMessage: '验证进程退出',
      gateHeadSha: HEAD,
      commit: EVIDENCE,
    });
    await flushVerdictDigests();
    const row = w.verdictOf(claimed.stepId);
    expect(row?.outcome).toBe('step_failed');
    expect(row?.headSha).toBe(EVIDENCE);
    expect(row?.expectedHeadSha).toBe(HEAD);
    expect(row?.patchDigest).toBe(deliveryDigest());
  });

  test('审核步失败且报了另一枚 head 时，判定记下它、摘要不绑定', async () => {
    const ranges: Record<string, unknown> = { [`${BASE}...${HEAD}`]: deliveryCompare() };
    world = await setup({ githubFetch: scriptedGithub(ranges) });
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    attachGithubRepo(w, buildId);
    const stepId = await claimReview(w, buildId);
    await w.done(stepId, { status: 'failed', errorMessage: '审核进程退出', gateHeadSha: OTHER });
    await flushVerdictDigests();
    const row = w.verdictOf(stepId);
    expect(row?.outcome).toBe('step_failed');
    expect(row?.headSha).toBe(OTHER);
    expect(row?.patchDigest).toBeNull();
  });

  test('verify 回报形如 0 token 静默成功时仍按判定收尾，记下报来的 head', async () => {
    world = await setup({ githubFetch: unreachableGithub });
    const w = world;
    const buildId = await reachVerify(w);
    attachGithubRepo(w, buildId);
    const claimed = await w.claim();
    expect(claimed.kind).toBe('verify');
    await w.done(claimed.stepId, {
      status: 'success',
      commit: EVIDENCE,
      noOutput: true,
      usage: [{ model: 'stub-gw/stub-model', input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }],
      verifyVerdict: { passed: true, conclusion: '过了', evidence: [] },
    });
    await flushVerdictDigests();
    const row = w.verdictOf(claimed.stepId);
    expect(row?.outcome).toBe('pass');
    expect(row?.headSha).toBe(EVIDENCE);
    expect(row?.patchDigest).toBeNull();
  });
});
