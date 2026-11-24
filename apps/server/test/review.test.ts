import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  claimedStepSchema,
  conversationBranch,
  MERGE_ANNOUNCEMENT,
  REVIEW_VERDICT_KIND,
  reviewVerdictSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  build as buildTable,
  message as messageTable,
  plan as planTable,
  project as projectTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import { sweepAbandonedBuildSteps } from '../src/services/build-abandoned-sweep.js';
import type { TestServer } from './helpers.js';
import {
  bootServer,
  claimedGeneration,
  issueApiKey,
  postProject,
  seedRoute,
  seedSessionRoute,
  startLegacyBuild,
  withVerification,
} from './helpers.js';

const SESSION_ROUTE_ID = 'route-session-1';
const REVIEW_ROUTE_ID = 'route-reviewer-1';
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
  startBuild(withPlan?: boolean): string;
  claim(): Promise<{ stepId: string; kind: string }>;
  done(stepId: string, body: Record<string, unknown>): Promise<void>;
  uploadPlan(stepId: string, content: string): Promise<void>;
  confirm(buildId: string): Promise<void>;
  seedReviewStep(buildId: string): void;
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
  seedSessionRoute(s, { id: SESSION_ROUTE_ID, provider: 'stub-gw', modelId: 'stub-model' });
  seedRoute(s, 'review', {
    id: REVIEW_ROUTE_ID,
    provider: 'stub-gw',
    modelId: 'stub-model',
  });
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({ teamId: s.team.id, name: 'review-mbp', cliVersion: '0.1.0' }),
  });

  expect(enrollRes.status).toBe(200);
  const { token: machineToken } = (await enrollRes.json()) as { token: string; machineId: string };
  const projectId = await postProject(
    s.app,
    opts.hosted ? 'review-hosted' : 'demo',
    opts.hosted ? { repoKind: 'hosted' } : {},
  );
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '审核探针', spec: '实现一段示例代码供审核' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };

  function startBuild(withPlan = true): string {
    return startLegacyBuild(s, todoId, { withPlan });
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
      body: { generation: claimedGeneration(s.db, stepId), ...body },
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
  function seedReviewStep(buildId: string): void {
    s.db
      .insert(stepTable)
      .values({
        id: `review-${buildId}`,
        buildId,
        kind: 'review',
        status: 'pending',
        prompt: `${JSON.stringify({ kind: 'review', agentId: REVIEW_ROUTE_ID, gate: 'review' })}\n请审核`,
        createdAt: Date.now(),
      })
      .run();
  }

  async function seedConvChanges(buildId: string, files: Record<string, string>): Promise<void> {
    const projRow = s.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
    expect(projRow?.repoName).toBeTruthy();
    const bareDir = join(s.reposDir, s.team.id, `${projRow?.repoName}.git`);
    const dir = makeTestTempDir('cairn-review-511-');
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
    seedReviewStep,
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

  test('happy path: claiming the review step -> the claim payload agent = the review routing rule (not the session rule)', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');

    w.seedReviewStep(buildId);

    const claimRes = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
      cred: w.machineToken,
      body: {},
    });
    const claimBody = (await claimRes.json()) as { step: unknown };
    const parsed = claimedStepSchema.parse(claimBody.step);
    expect(parsed.step.kind).toBe('review');
    expect(parsed.agent?.id).toBe(REVIEW_ROUTE_ID);
    expect(parsed.agent?.id).not.toBe(SESSION_ROUTE_ID);
  });

  test('terminal loop (no blocking): the review step done(success, empty verdict) -> the REVIEW_VERDICT_KIND message lands + the phase unchanged', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    w.seedReviewStep(buildId);
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
    expect(reviewStep?.status).toBe('stopped');
    expect(messages.some((m) => m.content === MERGE_ANNOUNCEMENT)).toBe(false);
    expect(w.stepsOf(buildId).filter((s) => s.kind === 'plan')).toHaveLength(1);
  });

  test('a retired blocking review is recorded without replanning or changing the delivered plan', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    w.seedReviewStep(buildId);
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

    expect(w.todoRow().phase).toBe('confirm');
    const planSteps = w.stepsOf(buildId).filter((s) => s.kind === 'plan');
    expect(planSteps).toHaveLength(1);
    const reviewStep = w.stepsOf(buildId).find((s) => s.kind === 'review');
    expect(reviewStep?.status).toBe('stopped');

    const reviseNote = messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        !m.content.startsWith('{') &&
        m.content.includes('AI 审核检测到'),
    );
    expect(reviseNote).toBeUndefined();
  });

  test('terminal loop (the daemon sent no findings): the verdict fallback message lands + no revision triggered', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    w.seedReviewStep(buildId);

    const reviewClaimed = await w.claim();
    await w.done(reviewClaimed.stepId, { status: 'success' });

    const messages = w.messagesOf(buildId);
    expect(
      messages.find((m) => m.id === `retired-gate-report-${reviewClaimed.stepId}`)?.content,
    ).toContain('The delivered result is unchanged');
    expect(w.todoRow().phase).toBe('confirm');
    expect(w.stepsOf(buildId).filter((s) => s.kind === 'plan')).toHaveLength(1);
  });

  test('terminal loop (#700 the daemon reports extraction failure): verdict extraction failed + the cause surfaced + no revision triggered', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
    await w.done(planClaimed.stepId, { status: 'success' });
    w.seedReviewStep(buildId);

    const reviewClaimed = await w.claim();
    await w.done(reviewClaimed.stepId, {
      status: 'success',
      findingsError: '审核步输出中未找到 verdict JSON（agent 未按契约输出）',
    });

    const messages = w.messagesOf(buildId);
    expect(
      messages.find((m) => m.id === `retired-gate-report-${reviewClaimed.stepId}`)?.content,
    ).toContain('审核步输出中未找到 verdict JSON（agent 未按契约输出）');
    expect(w.todoRow().phase).toBe('confirm');
    expect(w.stepsOf(buildId).filter((s) => s.kind === 'plan')).toHaveLength(1);
  });
});

const _CONV_CHANGE_FILE = 'src/parse.ts';
const _CONV_CHANGE_BODY = 'export function parseInput() {}\n';
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
  expect(w.todoRow().phase).toBe('done');
  w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, w.todoId)).run();
  return buildId;
}

function _reviewPromptOf(w: World, buildId: string): string {
  const step = w.stepsOf(buildId).find((s) => s.kind === 'review');
  expect(step).toBeDefined();
  return step?.prompt ?? '';
}

describe('retired gate work cannot take delivery back from the user', () => {
  test.each(['previous version', 'current version'] as const)(
    'a user completion requested in the %s does not wait for a retired reviewer',
    async (version) => {
      const w = await setupWorld();
      const buildId = await advanceToReviewGate(w);
      w.seedReviewStep(buildId);
      const claimed = await w.claim();
      if (version === 'previous version') {
        w.s.db
          .update(buildTable)
          .set({ afterStopPhase: 'done' })
          .where(eq(buildTable.id, buildId))
          .run();
        sweepAbandonedBuildSteps(w.s.svc);
      } else {
        const response = await call(w.s.app, 'POST', `/api/todos/${w.todoId}/stop-and-done`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ state: 'done' });
      }
      expect(w.todoRow().phase).toBe('done');
      const completed = w.todoRow();
      await w.done(claimed.stepId, {
        status: 'success',
        findings: {
          conclusion: 'BLOCK',
          findings: [{ id: '1', severity: 'blocking', summary: 'late finding' }],
        },
      });
      expect(w.todoRow()).toEqual(completed);
      expect(w.buildRow(buildId).afterStopPhase).toBeNull();
    },
  );

  test.each(['success', 'failed', 'stopped'] as const)(
    'a late %s report preserves a review-phase delivery, including a blocking verdict',
    async (status) => {
      const w = await setupWorld();
      const buildId = await advanceToReviewGate(w);
      w.seedReviewStep(buildId);
      const claimed = await w.claim();
      w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
      w.s.db
        .update(buildTable)
        .set({ prNumber: 23, prUrl: 'https://github.com/acme/app/pull/23' })
        .where(eq(buildTable.id, buildId))
        .run();
      const delivered = w.buildRow(buildId);
      sweepAbandonedBuildSteps(w.s.svc);
      const task = w.todoRow();
      expect(task.phase).toBe('done');
      expect(w.stepsOf(buildId).find((s) => s.id === claimed.stepId)?.archiveStop).toBe(
        'requested',
      );
      const stopped = await call(w.s.app, 'GET', `/api/machine/stop?stepId=${claimed.stepId}`, {
        cred: w.machineToken,
      });
      expect(stopped.status).toBe(200);
      expect(await stopped.json()).toMatchObject({ discard: false });
      const outcome = {
        status,
        ...(status === 'failed'
          ? {
              errorMessage: 'quota exhausted',
              quotaBlock: { kind: 'capacity', providerId: 'stub-gw', reason: 'quota exhausted' },
            }
          : {}),
        findings: {
          conclusion: 'BLOCK',
          findings: [{ id: '1', severity: 'blocking', summary: 'late finding' }],
        },
        prNumber: 7,
        prUrl: 'https://github.com/acme/app/pull/7',
        changesDiff:
          'diff --git a/late.ts b/late.ts\n--- a/late.ts\n+++ b/late.ts\n@@ -1 +1 @@\n-old\n+late\n',
      };
      await w.done(claimed.stepId, outcome);
      await w.done(claimed.stepId, outcome);
      expect(w.todoRow()).toEqual(task);
      expect(w.buildRow(buildId)).toEqual(delivered);
      expect(
        w.stepsOf(buildId).filter((s) => s.kind === 'plan' || s.kind === 'build'),
      ).toHaveLength(2);
      expect(w.stepsOf(buildId).find((s) => s.id === claimed.stepId)?.status).toBe('stopped');
      expect(
        w.messagesOf(buildId).filter((m) => m.id === `retired-gate-report-${claimed.stepId}`),
      ).toHaveLength(1);
    },
  );

  test.each(['pending', 'waiting_quota', 'claimed'] as const)(
    'upgrade retires %s gate work and hands an already delivered build to the user once',
    async (status) => {
      const w = await setupWorld();
      const buildId = await advanceToReviewGate(w);
      const execution = w.stepsOf(buildId).find((s) => s.kind === 'build')!;
      w.s.db
        .insert(stepTable)
        .values({
          id: 'old-verify',
          buildId,
          kind: 'verify',
          status,
          machineId: execution.machineId,
          claimedAt: Date.now(),
          lastHeartbeatAt: Date.now(),
          createdAt: Date.now(),
        })
        .run();
      w.s.db
        .update(todoTable)
        .set({ phase: 'building', hasChanges: true })
        .where(eq(todoTable.id, w.todoId))
        .run();
      sweepAbandonedBuildSteps(w.s.svc);
      const delivered = w.todoRow();
      expect(delivered).toMatchObject({ phase: 'done', hasChanges: true });
      expect(w.buildRow(buildId).errorMessage).toBeNull();
      const old = w.stepsOf(buildId).find((s) => s.id === 'old-verify');
      expect(old).toMatchObject(
        status === 'claimed'
          ? { status: 'claimed', archiveStop: 'requested' }
          : { status: 'stopped' },
      );
      sweepAbandonedBuildSteps(w.s.svc);
      expect(w.todoRow()).toEqual(delivered);
    },
  );

  test.each([
    'live implementation',
    'pending question',
    'failed',
    'done',
    'closed',
    'archived',
    'superseded',
  ] as const)('upgrade does not revive or prematurely deliver a task with %s', async (state) => {
    const w = await setupWorld();
    const buildId = await advanceToReviewGate(w);
    w.s.db
      .insert(stepTable)
      .values({
        id: 'old-verify',
        buildId,
        kind: 'verify',
        status: 'pending',
        createdAt: Date.now(),
      })
      .run();
    if (state === 'live implementation') {
      w.s.db
        .insert(stepTable)
        .values({
          id: 'ongoing-session',
          buildId,
          kind: 'session',
          status: 'pending',
          createdAt: Date.now() + 1,
        })
        .run();
    }
    if (state === 'pending question') {
      w.s.db
        .insert(messageTable)
        .values({
          id: 'pending-question',
          conversationId: buildId,
          role: 'assistant',
          content: {
            kind: 'ask_user_question',
            requestId: 'pending-question',
            status: 'pending',
            questions: [{ header: 'Filename', question: 'Which filename?', options: [] }],
            answers: null,
          },
          createdAt: Date.now(),
        })
        .run();
    }
    w.s.db
      .update(todoTable)
      .set({
        phase: state === 'failed' || state === 'done' || state === 'closed' ? state : 'building',
        ...(state === 'archived' ? { archivedAt: Date.now() } : {}),
        ...(state === 'superseded' ? { latestBuildId: 'newer-build' } : {}),
      })
      .where(eq(todoTable.id, w.todoId))
      .run();
    const before = w.todoRow();
    sweepAbandonedBuildSteps(w.s.svc);
    expect(w.todoRow()).toEqual(before);
    expect(w.stepsOf(buildId).find((s) => s.id === 'old-verify')?.status).toBe('stopped');
    if (state === 'live implementation')
      expect(w.stepsOf(buildId).find((s) => s.id === 'ongoing-session')?.status).toBe('pending');
  });
});
