import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  claimedStepSchema,
  conversationBranch,
  MERGE_ANNOUNCEMENT,
  parseReviewPromptMeta,
  REVIEW_ANNOUNCEMENT,
  REVIEW_VERDICT_KIND,
  reviewVerdictSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  message as messageTable,
  plan as planTable,
  project as projectTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import type { TestServer } from './helpers.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  req,
  withVerification,
} from './helpers.js';

const AGENT_ID = 'agent-review-1';
const REVIEW_AGENT_ID = 'agent-reviewer-1';
const CROSS_VENDOR_AGENT_ID = 'agent-rival-1';
const PLAN_FILE_NAME = 'plan.md';

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'review-probe',
  GIT_AUTHOR_EMAIL: 'probe@localhost',
  GIT_COMMITTER_NAME: 'review-probe',
  GIT_COMMITTER_EMAIL: 'probe@localhost',
};

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

interface World {
  s: TestServer;
  todoId: string;
  projectId: string;
  seedConvChanges(buildId: string, files: Record<string, string>): Promise<void>;
  machineToken: string;
  startBuild(withPlan?: boolean): Promise<string>;
  claim(): Promise<{ stepId: string; kind: string }>;
  done(stepId: string, body: Record<string, unknown>): Promise<void>;
  uploadPlan(stepId: string, content: string): Promise<void>;
  confirm(buildId: string): Promise<void>;
  startReview(buildId: string, body?: { agentId: string; focus?: string }): Promise<Response>;
  todoRow(): ReturnType<typeof loadTodoRow>;
  buildRow(buildId: string): ReturnType<typeof loadBuildRow>;
  stepsOf(buildId: string): ReturnType<typeof loadStepsOf>;
  messagesOf(buildId: string): ReturnType<typeof loadMessagesOf>;
  planContent(buildId: string): ReturnType<typeof loadPlanContent>;
}

function loadTodoRow(s: TestServer, todoId: string) {
  return s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
}
function loadBuildRow(s: TestServer, buildId: string) {
  return s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
}
function loadStepsOf(s: TestServer, buildId: string) {
  return s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
}
function loadMessagesOf(s: TestServer, buildId: string) {
  return s.db.select().from(messageTable).where(eq(messageTable.conversationId, buildId)).all();
}
function loadPlanContent(s: TestServer, buildId: string) {
  return s.db.select().from(planTable).where(eq(planTable.buildId, buildId)).all();
}

async function setupWorld(opts: { hosted?: boolean } = {}): Promise<World> {
  const s = bootServer({ claimHoldMs: 200, pingIntervalMs: 3_600_000 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-review',
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
    })
    .run();

  s.db
    .insert(agentTable)
    .values({
      id: REVIEW_AGENT_ID,
      teamId: s.team.id,
      displayName: 'stub-reviewer',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'review-mbp', cliVersion: '0.1.0' },
  });

  bindAllAgents(s);
  expect(enrollRes.status).toBe(200);
  const { token: machineToken } = (await enrollRes.json()) as { token: string; machineId: string };
  let projectId: string;
  if (opts.hosted) {
    const hostedRes = await call(s.app, 'POST', '/api/projects', {
      body: { name: 'review-hosted', repoKind: 'hosted' },
    });
    expect(hostedRes.status).toBe(201);
    projectId = ((await hostedRes.json()) as { id: string }).id;
  } else {
    projectId = await postProject(s.app);
  }
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '审核探针', spec: '实现一段示例代码供审核' },
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
  async function claim() {
    const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: machineToken,
      body: {},
    });
    const body = (await res.json()) as { step: unknown };
    if (!body.step) throw new Error('claim returned no step');
    const parsed = claimedStepSchema.parse(body.step);
    return { stepId: parsed.step.id, kind: parsed.step.kind };
  }
  async function done(stepId: string, body: Record<string, unknown>): Promise<void> {
    const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: machineToken,
      body,
    });
    expect(res.status).toBe(200);
  }
  async function uploadPlan(stepId: string, content: string): Promise<void> {
    const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      cred: machineToken,
      body: { files: [{ name: PLAN_FILE_NAME }] },
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
  async function confirm(buildId: string): Promise<void> {
    const res = await call(s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'confirm' },
    });
    expect(res.status).toBe(202);
  }
  async function startReview(
    buildId: string,
    body: { agentId: string; focus?: string } = { agentId: REVIEW_AGENT_ID },
  ): Promise<Response> {
    return call(s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review', ...body },
    });
  }

  async function seedConvChanges(buildId: string, files: Record<string, string>): Promise<void> {
    const projRow = s.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
    expect(projRow?.repoName).toBeTruthy();
    const bareDir = join(s.reposDir, s.team.id, `${projRow?.repoName}.git`);
    const dir = mkdtempSync(join(tmpdir(), 'cairn-review-511-'));
    dirs.push(dir);
    const repoDir = join(dir, 'repo');
    const git = async (args: string[]) => {
      const r = await runGit(args, { cwd: repoDir, env: GIT_ENV, timeoutMs: 60_000 });
      expect(r.code, r.stderr).toBe(0);
    };
    const clone = await runGit(['clone', bareDir, repoDir], { cwd: dir, env: GIT_ENV });
    expect(clone.code, clone.stderr).toBe(0);
    await git(['checkout', '-B', conversationBranch(buildId)]);
    for (const [path, content] of Object.entries(files)) {
      const abs = join(repoDir, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    await git(['add', '-A']);
    await git(['commit', '-m', 'conv round']);
    await git(['push', 'origin', conversationBranch(buildId)]);
  }

  return {
    s,
    todoId,
    projectId,
    seedConvChanges,
    machineToken,
    startBuild,
    claim,
    done,
    uploadPlan,
    confirm,
    startReview,
    todoRow: () => loadTodoRow(s, todoId),
    buildRow: (buildId: string) => loadBuildRow(s, buildId),
    stepsOf: (buildId: string) => loadStepsOf(s, buildId),
    messagesOf: (buildId: string) => loadMessagesOf(s, buildId),
    planContent: (buildId: string) => loadPlanContent(s, buildId),
  };
}

describe('the AI review initiation write surface (M7 #312)', () => {
  let w: World;
  beforeEach(async () => {
    w = await setupWorld();
  });

  test('failure mode 1: planning phase -> 409, not silent', async () => {
    const buildId = await w.startBuild(true);
    const claimed = await w.claim();
    expect(claimed.kind).toBe('plan');
    const res = await w.startReview(buildId);
    expect(res.status).toBe(409);
    expect(w.stepsOf(buildId).find((s) => s.kind === 'review')).toBeUndefined();
  });

  test('failure mode 2: missing agentId -> 400 (zod body schema)', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    const res = await req(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review', focus: '看看安全' },
    });
    expect(res.status).toBe(400);
  });

  test('agent selection stays out of the server: an explicitly named same-vendor agentId is accepted as usual (no regression to 409)', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    expect(w.todoRow().assignment?.build?.agentId).toBe(AGENT_ID);

    const sameVendor = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID, focus: '' });
    expect(sameVendor.status).toBe(202);
    const sameMeta = parseReviewPromptMeta(
      w.stepsOf(buildId).find((s) => s.kind === 'review')?.prompt ?? null,
    );
    expect(sameMeta?.agentId).toBe(REVIEW_AGENT_ID);
  });

  test('agent selection stays out of the server: a cross-vendor agentId is accepted as usual too (no vendor criterion)', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');

    w.s.db
      .insert(agentTable)
      .values({
        id: CROSS_VENDOR_AGENT_ID,
        teamId: w.s.team.id,
        displayName: 'stub-rival',
        provider: 'rival-gw',
        modelId: 'rival-model',
      })
      .run();
    bindAllAgents(w.s);

    const res = await w.startReview(buildId, { agentId: CROSS_VENDOR_AGENT_ID, focus: '' });
    expect(res.status).toBe(202);
    const meta = parseReviewPromptMeta(
      w.stepsOf(buildId).find((s) => s.kind === 'review')?.prompt ?? null,
    );
    expect(meta?.agentId).toBe(CROSS_VENDOR_AGENT_ID);
  });

  test('happy path: initiating review from confirm -> the review step queued + REVIEW_ANNOUNCEMENT + the phase stays confirm', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');

    const res = await w.startReview(buildId, {
      agentId: REVIEW_AGENT_ID,
      focus: '关注边界情况',
    });
    expect(res.status).toBe(202);

    const steps = w.stepsOf(buildId);
    const reviewStep = steps.find((s) => s.kind === 'review');
    expect(reviewStep).toBeDefined();
    expect(reviewStep?.status).toBe('pending');
    const meta = parseReviewPromptMeta(reviewStep?.prompt ?? null);
    expect(meta).not.toBeNull();
    expect(meta?.kind).toBe('review');
    expect(meta?.agentId).toBe(REVIEW_AGENT_ID);
    expect(reviewStep?.prompt ?? '').toContain('关注边界情况');

    const messages = w.messagesOf(buildId);
    const announcement = messages.find(
      (m) => m.role === 'user' && m.content === REVIEW_ANNOUNCEMENT,
    );
    expect(announcement).toBeDefined();

    expect(w.todoRow().phase).toBe('confirm');
    expect(w.todoRow().hasChanges).toBe(false);
  });

  test('happy path: claiming the review step -> the claim payload agent = the reviewer chosen in the dialog (not through the assignment slot)', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');

    const startRes = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(startRes.status).toBe(202);

    const claimRes = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
      cred: w.machineToken,
      body: {},
    });
    const claimBody = (await claimRes.json()) as { step: unknown };
    const parsed = claimedStepSchema.parse(claimBody.step);
    expect(parsed.step.kind).toBe('review');
    expect(parsed.agent?.id).toBe(REVIEW_AGENT_ID);
    expect(parsed.agent?.id).not.toBe(AGENT_ID);
  });

  test('happy path: empty focus allowed (the optional textarea may be empty)', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    const res = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID, focus: '' });
    expect(res.status).toBe(202);
    expect(w.stepsOf(buildId).find((s) => s.kind === 'review')).toBeDefined();
  });

  test('happy path: another review can be initiated from the review phase too', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    await w.confirm(buildId);
    expect(w.todoRow().phase).toBe('building');
    const buildClaimed = await w.claim();
    expect(buildClaimed.kind).toBe('build');
    await w.done(buildClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('review');
    const res = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(res.status).toBe(202);
    expect(w.stepsOf(buildId).filter((s) => s.kind === 'review')).toHaveLength(1);
  });

  test('terminal loop (no blocking): the review step done(success, empty verdict) -> the REVIEW_VERDICT_KIND message lands + the phase unchanged', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(w.todoRow().phase).toBe('confirm');

    const reviewClaimed = await w.claim();
    expect(reviewClaimed.kind).toBe('review');
    expect(reviewClaimed.stepId).not.toBe('');
    await w.done(reviewClaimed.stepId, {
      status: 'success',
      findings: { conclusion: '方案通过，无 blocking 风险', findings: [] },
    });

    const messages = w.messagesOf(buildId);
    const verdictRow = messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (() => {
          try {
            const parsed = JSON.parse(m.content) as { kind?: string };
            return parsed.kind === REVIEW_VERDICT_KIND;
          } catch {
            return false;
          }
        })(),
    );
    expect(verdictRow).toBeDefined();
    const parsedVerdict = reviewVerdictSchema.parse(
      JSON.parse((verdictRow as { content: string }).content).verdict,
    );
    expect(parsedVerdict.conclusion).toBe('方案通过，无 blocking 风险');
    expect(parsedVerdict.findings).toHaveLength(0);

    expect(w.todoRow().phase).toBe('confirm');
    const reviewStep = w.stepsOf(buildId).find((s) => s.kind === 'review');
    expect(reviewStep?.status).toBe('done');
    expect(messages.some((m) => m.content === MERGE_ANNOUNCEMENT)).toBe(false);
    expect(w.stepsOf(buildId).filter((s) => s.kind === 'plan')).toHaveLength(1);
  });

  test('terminal loop (blocking): the review step done(success, with a blocking verdict) -> the REVIEW_VERDICT_KIND message + the phase moves to planning + a replan step queued', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(w.todoRow().phase).toBe('confirm');

    const reviewClaimed = await w.claim();
    expect(reviewClaimed.kind).toBe('review');
    await w.done(reviewClaimed.stepId, {
      status: 'success',
      findings: {
        conclusion: '方案在边界情况上存在硬风险',
        findings: [
          {
            id: '1',
            severity: 'blocking',
            summary: '未处理空输入',
            description: 'parseInput 对空字符串未做防御',
            file: 'src/parse.ts',
            line: 42,
            suggestion: '加入空字符串 early return',
          },
          {
            id: '2',
            severity: 'suggestion',
            summary: '可选：日志格式',
          },
        ],
      },
    });

    const messages = w.messagesOf(buildId);
    const verdictRow = messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (() => {
          try {
            const parsed = JSON.parse(m.content) as { kind?: string };
            return parsed.kind === REVIEW_VERDICT_KIND;
          } catch {
            return false;
          }
        })(),
    );
    expect(verdictRow).toBeDefined();
    const parsedVerdict = reviewVerdictSchema.parse(
      JSON.parse((verdictRow as { content: string }).content).verdict,
    );
    expect(parsedVerdict.findings.some((f) => f.severity === 'blocking')).toBe(true);

    expect(w.todoRow().phase).toBe('planning');
    const planSteps = w.stepsOf(buildId).filter((s) => s.kind === 'plan');
    expect(planSteps).toHaveLength(2);
    const revisePrompt = planSteps[1]?.prompt ?? '';
    expect(revisePrompt).toContain('审核结论');
    expect(revisePrompt).toContain('Blocking findings');
    expect(revisePrompt).toContain('未处理空输入');
    expect(revisePrompt).toContain('src/parse.ts:42');
    const reviewStep = w.stepsOf(buildId).find((s) => s.kind === 'review');
    expect(reviewStep?.status).toBe('done');

    const reviseNote = messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        !m.content.startsWith('{') &&
        m.content.includes('AI 审核检测到'),
    );
    expect(reviseNote?.content).toContain('1 处 blocking 风险');
    expect(reviseNote?.content).toContain('已自动入队重规划步');
  });

  test('terminal loop (the daemon sent no findings): the verdict fallback message lands + no revision triggered', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });

    const reviewClaimed = await w.claim();
    await w.done(reviewClaimed.stepId, { status: 'success' });

    const messages = w.messagesOf(buildId);
    const verdictRow = messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (() => {
          try {
            const parsed = JSON.parse(m.content) as { kind?: string };
            return parsed.kind === REVIEW_VERDICT_KIND;
          } catch {
            return false;
          }
        })(),
    );
    expect(verdictRow).toBeDefined();
    const parsedVerdict = reviewVerdictSchema.parse(
      JSON.parse((verdictRow as { content: string }).content).verdict,
    );
    expect(parsedVerdict.conclusion).toBe('审核未返回结论');
    expect(parsedVerdict.findings).toHaveLength(0);
    expect(w.todoRow().phase).toBe('confirm');
    expect(w.stepsOf(buildId).filter((s) => s.kind === 'plan')).toHaveLength(1);
  });

  test('terminal loop (#700 the daemon reports extraction failure): verdict extraction failed + the cause surfaced + no revision triggered', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });

    const reviewClaimed = await w.claim();
    await w.done(reviewClaimed.stepId, {
      status: 'success',
      findingsError: '审核步输出中未找到 verdict JSON（agent 未按契约输出）',
    });

    const messages = w.messagesOf(buildId);
    const verdictRow = messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (() => {
          try {
            const parsed = JSON.parse(m.content) as { kind?: string };
            return parsed.kind === REVIEW_VERDICT_KIND;
          } catch {
            return false;
          }
        })(),
    );
    expect(verdictRow).toBeDefined();
    const row = JSON.parse((verdictRow as { content: string }).content) as {
      verdict: { conclusion: string; findings: unknown[] };
      extractionError?: string;
    };
    expect(row.verdict.conclusion).toBe('判定提取失败');
    expect(row.verdict.findings).toHaveLength(0);
    expect(row.extractionError).toBe('审核步输出中未找到 verdict JSON（agent 未按契约输出）');
    expect(w.todoRow().phase).toBe('confirm');
    expect(w.stepsOf(buildId).filter((s) => s.kind === 'plan')).toHaveLength(1);
  });
});

const CONV_CHANGE_FILE = 'src/parse.ts';
const CONV_CHANGE_BODY = 'export function parseInput() {}\n';
const PLAN_V1 = withVerification('# plan v1\n\n## Changes\n- 加 parseInput\n');

async function advanceToReviewGate(w: World): Promise<string> {
  const buildId = await w.startBuild(true);
  const planClaimed = await w.claim();
  await w.uploadPlan(planClaimed.stepId, PLAN_V1);
  await w.done(planClaimed.stepId, { status: 'success', sessionId: 'sess-plan' });
  await w.confirm(buildId);
  const buildClaimed = await w.claim();
  expect(buildClaimed.kind).toBe('build');
  await w.done(buildClaimed.stepId, { status: 'success', sessionId: 'sess-build' });
  expect(w.todoRow().phase).toBe('review');
  return buildId;
}

function reviewPromptOf(w: World, buildId: string): string {
  const step = w.stepsOf(buildId).find((s) => s.kind === 'review');
  expect(step).toBeDefined();
  return step?.prompt ?? '';
}

describe('review step material forks by gate (#511)', () => {
  beforeEach(async () => {
    w = await setupWorld({ hosted: true });
  });
  let w: World;

  test('failure mode 1: the confirm-gate material contains no changes -- even when the conversation branch already has them', async () => {
    const buildId = await w.startBuild(true);
    await w.seedConvChanges(buildId, { [CONV_CHANGE_FILE]: CONV_CHANGE_BODY });
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, PLAN_V1);
    await w.done(planClaimed.stepId, { status: 'success', sessionId: 'sess-plan' });
    expect(w.todoRow().phase).toBe('confirm');

    const res = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(res.status).toBe(202);
    const prompt = reviewPromptOf(w, buildId);
    expect(prompt).toContain(PLAN_V1);
    expect(prompt).not.toContain(CONV_CHANGE_FILE);
    expect(parseReviewPromptMeta(prompt)?.gate).toBe('confirm');
  });

  test('failure mode 2: the review-gate material contains the plan + changes (file paths and line-by-line diffs all present)', async () => {
    const buildId = await advanceToReviewGate(w);
    await w.seedConvChanges(buildId, { [CONV_CHANGE_FILE]: CONV_CHANGE_BODY });

    const res = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(res.status).toBe(202);
    const prompt = reviewPromptOf(w, buildId);
    expect(prompt).toContain(PLAN_V1);
    expect(prompt).toContain(CONV_CHANGE_FILE);
    expect(prompt).toContain('+export function parseInput() {}');
    expect(parseReviewPromptMeta(prompt)?.gate).toBe('review');
  });

  test('failure mode 3: an empty change surface at the review gate -> initiation still works, the material honestly says no changes', async () => {
    const buildId = await advanceToReviewGate(w);
    const res = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(res.status).toBe(202);
    const prompt = reviewPromptOf(w, buildId);
    expect(prompt).toContain(PLAN_V1);
    expect(prompt).toContain('变更面为空');
    expect(prompt).toContain('检出');
    expect(prompt).not.toContain(CONV_CHANGE_FILE);
    expect(parseReviewPromptMeta(prompt)?.gate).toBe('review');
  });

  test('failure mode 4: the changes in the material = the same computation path as the human change surface (the GET /changes file set matches)', async () => {
    const buildId = await advanceToReviewGate(w);
    await w.seedConvChanges(buildId, {
      [CONV_CHANGE_FILE]: CONV_CHANGE_BODY,
      'plan.md': '# plan v1\n\n## Changes\n- 加 parseInput\n- 再改一行\n',
    });
    const changesRes = await call(w.s.app, 'GET', `/api/builds/${buildId}/changes`);
    expect(changesRes.status).toBe(200);
    const { files } = (await changesRes.json()) as { files: { path: string }[] };
    expect(files.length).toBeGreaterThan(0);

    await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    const prompt = reviewPromptOf(w, buildId);
    for (const file of files) expect(prompt).toContain(file.path);
    expect(prompt).toContain(`本轮共 ${files.length} 个文件改动`);
  });

  test('failure mode 6: the review step claim payload session = new (the prompt goes to a new session, not continuing the main conv)', async () => {
    const buildId = await advanceToReviewGate(w);
    await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    const claimRes = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
      cred: w.machineToken,
      body: {},
    });
    const parsed = claimedStepSchema.parse(((await claimRes.json()) as { step: unknown }).step);
    expect(parsed.step.kind).toBe('review');
    expect(parsed.session.action).toBe('new');
    expect(parsed.session.sessionId).toBeNull();
    expect(parsed.instruction ?? '').toContain(PLAN_V1);
  });
});
