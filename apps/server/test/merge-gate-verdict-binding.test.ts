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

const PASS_FINDINGS = {
  conclusion: 'pass',
  gateLoosening: false,
  evalRulerChange: false,
  findings: [] as [],
};

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
    body: { title: 'verdict binding probe', spec: 'S5a' },
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

describe('#1404 S5a verdict binding', () => {
  test('the review gate dispatch meta carries expectedHeadSha; extraction failure lands as extraction_failed and reads back', async () => {
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
      findingsError: 'no verdict JSON found in the review step output',
    });

    const row = w.verdictOf(claimed.stepId);
    expect(row).toBeDefined();
    expect(row?.outcome).toBe('extraction_failed');
    expect(row?.outcome).not.toBe('pass');
    expect(row?.expectedHeadSha).toBe(HEAD);
    expect(row?.headSha).toBeNull();
    expect(row?.kind).toBe('review');
    expect(row?.buildId).toBe(buildId);
  });

  test('verify extraction failure lands as extraction_failed, expectedHeadSha reads back from the database', async () => {
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
    expect(verifyStep?.prompt ?? '').toContain('the code is read-only');

    const claimed = await w.claim();
    expect(claimed.kind).toBe('verify');
    await w.done(claimed.stepId, {
      status: 'success',
      verifyVerdictError: 'no verdict JSON found in the verify step output',
    });

    const row = w.verdictOf(claimed.stepId);
    expect(row).toBeDefined();
    expect(row?.outcome).toBe('extraction_failed');
    expect(row?.outcome).not.toBe('pass');
    expect(row?.expectedHeadSha).toBe(HEAD);
    expect(row?.headSha).toBeNull();
    expect(row?.kind).toBe('verify');
  });

  test('a passing review without an observed head remains unbound', async () => {
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
    expect(row?.outcome).toBe('unbound');
    expect(row?.expectedHeadSha).toBe(HEAD);
    expect(row?.headSha).toBeNull();
    expect(row?.patchDigest).toBeNull();
  });

  test('no gate_verdict row when the confirm gate has no code head', async () => {
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
      findingsError: 'no verdict JSON found in the review step output',
    });
    expect(w.verdictOf(claimed.stepId)).toBeUndefined();
  });

  test('when the latest checkpoint is not a lowercase SHA, dispatch still binds the previous delivery SHA', async () => {
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

  test('a review blocking verdict records its finding but never invents an observed head', async () => {
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
        conclusion: 'changes needed',
        gateLoosening: false,
        evalRulerChange: false,
        findings: [{ id: '1', severity: 'blocking', summary: 'missing tests' }],
      },
    });
    const row = w.verdictOf(stepId);
    expect(row?.outcome).toBe('block');
    expect(row?.headSha).toBeNull();
    expect(row?.expectedHeadSha).toBe(HEAD);
  });

  test('a failed review step records step_failed without inventing an observed head', async () => {
    world = await setup();
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    const stepId = await claimReview(w, buildId);
    await w.done(stepId, { status: 'failed', errorMessage: 'review process exited' });
    const row = w.verdictOf(stepId);
    expect(row?.outcome).toBe('step_failed');
    expect(row?.headSha).toBeNull();
    expect(row?.expectedHeadSha).toBe(HEAD);
  });

  test('a verify pass lands as pass; with no reported head, headSha is null', async () => {
    world = await setup();
    const w = world;
    await reachVerify(w);
    const claimed = await w.claim();
    expect(claimed.kind).toBe('verify');
    await w.done(claimed.stepId, {
      status: 'success',
      verifyVerdict: { passed: true, conclusion: 'passed', evidence: [] },
    });
    expect(w.verdictOf(claimed.stepId)?.outcome).toBe('pass');
    expect(w.verdictOf(claimed.stepId)?.headSha).toBeNull();
  });

  test('a failed verify lands as block; with no reported head, headSha is null', async () => {
    world = await setup();
    const w = world;
    await reachVerify(w);
    const claimed = await w.claim();
    expect(claimed.kind).toBe('verify');
    await w.done(claimed.stepId, {
      status: 'success',
      verifyVerdict: { passed: false, conclusion: 'failed', evidence: [] },
    });
    expect(w.verdictOf(claimed.stepId)?.outcome).toBe('block');
    expect(w.verdictOf(claimed.stepId)?.headSha).toBeNull();
  });

  test('with the head matching, the delivery digest is written into the verdict from the GitHub compare', async () => {
    const ranges: Record<string, unknown> = { [`${BASE}...${HEAD}`]: deliveryCompare() };
    world = await setup({ githubFetch: scriptedGithub(ranges) });
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    attachGithubRepo(w, buildId);
    const stepId = await claimReview(w, buildId);
    await w.done(stepId, { status: 'success', gateHeadSha: HEAD, findings: PASS_FINDINGS });
    await flushVerdictDigests();
    const row = w.verdictOf(stepId);
    expect(row?.headSha).toBe(HEAD);
    expect(row?.patchDigest).toBe(deliveryDigest());
  });

  test('when verify only appends commits inside the evidence directory, the digest binds the delivery head from dispatch time', async () => {
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
      verifyVerdict: { passed: true, conclusion: 'passed', evidence: [] },
    });
    await flushVerdictDigests();
    const row = w.verdictOf(claimed.stepId);
    expect(row?.outcome).toBe('pass');
    expect(row?.headSha).toBe(EVIDENCE);
    expect(row?.expectedHeadSha).toBe(HEAD);
    expect(row?.patchDigest).toBe(deliveryDigest());
  });

  test('when verify follow-up commits change code, no digest binding', async () => {
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
      verifyVerdict: { passed: true, conclusion: 'passed', evidence: [] },
    });
    expect(w.verdictOf(claimed.stepId)?.headSha).toBe(EVIDENCE);
    expect(w.verdictOf(claimed.stepId)?.patchDigest).toBeNull();
  });

  test('when verify renames code into the evidence directory, no digest binding', async () => {
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
      verifyVerdict: { passed: false, conclusion: 'failed', evidence: [] },
    });
    expect(w.verdictOf(claimed.stepId)?.outcome).toBe('block');
    expect(w.verdictOf(claimed.stepId)?.headSha).toBe(OTHER);
    expect(w.verdictOf(claimed.stepId)?.patchDigest).toBeNull();
  });

  test('when the evidence-directory compare hits the file cap, the not fully read list does not count as evidence-only changes', async () => {
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
      verifyVerdict: { passed: true, conclusion: 'passed', evidence: [] },
    });
    expect(w.verdictOf(claimed.stepId)?.headSha).toBe(EVIDENCE);
    expect(w.verdictOf(claimed.stepId)?.patchDigest).toBeNull();
  });

  test('when gateHeadSha is another SHA, record it; expected is not substituted', async () => {
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

  test('an invalid observed review head is ignored and expectedHeadSha is not substituted', async () => {
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
    expect(w.verdictOf(stepId)?.headSha).toBeNull();
  });

  test('when gateHeadSha equals expected but commit is a later code commit, no digest binding', async () => {
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

  test('the three-perspective fan-out writes one verdict each, perspective being each role', async () => {
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
      await w.done(stepId, { status: 'success', gateHeadSha: HEAD, findings: PASS_FINDINGS });
    }
    const perspectives = stepIds.map((id) => w.verdictOf(id)?.perspective).sort();
    expect(perspectives).toEqual([...REVIEW_FANOUT_ROLES].sort());
  });

  test('finishing again after the verdict row exists does not throw; the first-written row stays', async () => {
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
    await w.done(stepId, { status: 'success', gateHeadSha: HEAD, findings: PASS_FINDINGS });
    expect(w.verdictOf(stepId)?.outcome).toBe('block');
    expect(w.verdictOf(stepId)?.createdAt).toBe(1);
  });

  test('when GitHub hangs, /done does not wait for it; the verdict still lands, the digest stays null', async () => {
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
    await w.done(stepId, { status: 'success', gateHeadSha: HEAD, findings: PASS_FINDINGS });
    expect(Date.now() - started).toBeLessThan(2_000);
    const row = w.verdictOf(stepId);
    expect(row?.outcome).toBe('pass');
    expect(row?.headSha).toBe(HEAD);
    expect(row?.patchDigest).toBeNull();
    releaseHungGithub?.();
    await flushVerdictDigests();
    expect(w.verdictOf(stepId)?.patchDigest).toBeNull();
  });

  test('the digest stays unbound when GitHub is unreachable', async () => {
    world = await setup({ githubFetch: unreachableGithub });
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    attachGithubRepo(w, buildId);
    const stepId = await claimReview(w, buildId);
    await w.done(stepId, { status: 'success', gateHeadSha: HEAD, findings: PASS_FINDINGS });
    await flushVerdictDigests();
    const row = w.verdictOf(stepId);
    expect(row?.outcome).toBe('pass');
    expect(row?.headSha).toBe(HEAD);
    expect(row?.patchDigest).toBeNull();
  });

  test('when verify reports two drifted heads, the later-reported commit wins, also when GitHub is unreachable', async () => {
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
      verifyVerdict: { passed: true, conclusion: 'passed', evidence: [] },
    });
    await flushVerdictDigests();
    expect(w.verdictOf(claimed.stepId)?.headSha).toBe(EVIDENCE);
    expect(w.verdictOf(claimed.stepId)?.patchDigest).toBeNull();
  });

  test('when verify reports two drifted heads that both only touch the evidence directory, the digest binds the delivery head', async () => {
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
      verifyVerdict: { passed: true, conclusion: 'passed', evidence: [] },
    });
    await flushVerdictDigests();
    expect(w.verdictOf(claimed.stepId)?.headSha).toBe(EVIDENCE);
    expect(w.verdictOf(claimed.stepId)?.patchDigest).toBe(deliveryDigest());
  });

  test('a failed verify step records the evidence commit head; an evidence-only drift still binds the delivery digest', async () => {
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
      errorMessage: 'verify process exited',
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

  test('a failed review step that reported another head: the verdict records it, no digest binding', async () => {
    const ranges: Record<string, unknown> = { [`${BASE}...${HEAD}`]: deliveryCompare() };
    world = await setup({ githubFetch: scriptedGithub(ranges) });
    const w = world;
    const buildId = await reachReviewGate(w, {
      plan: { agentId: BUILDER_ID },
      build: { agentId: BUILDER_ID },
    });
    attachGithubRepo(w, buildId);
    const stepId = await claimReview(w, buildId);
    await w.done(stepId, {
      status: 'failed',
      errorMessage: 'review process exited',
      gateHeadSha: OTHER,
    });
    await flushVerdictDigests();
    const row = w.verdictOf(stepId);
    expect(row?.outcome).toBe('step_failed');
    expect(row?.headSha).toBe(OTHER);
    expect(row?.patchDigest).toBeNull();
  });

  test('a zero-token silent-success verify still finishes by its verdict, recording the reported head', async () => {
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
      verifyVerdict: { passed: true, conclusion: 'passed', evidence: [] },
    });
    await flushVerdictDigests();
    const row = w.verdictOf(claimed.stepId);
    expect(row?.outcome).toBe('pass');
    expect(row?.headSha).toBe(EVIDENCE);
    expect(row?.patchDigest).toBeNull();
  });
});
