import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimedStepSchema, conversationBranch } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
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
  withVerification,
} from './helpers.js';

const AGENT_ID = 'agent-702-1';
const REVIEW_AGENT_ID = 'agent-702-reviewer';
const PLAN_FILE_NAME = 'plan.md';

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'restore-probe',
  GIT_AUTHOR_EMAIL: 'probe@localhost',
  GIT_COMMITTER_NAME: 'restore-probe',
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
  machineToken: string;
  startBuild(withPlan?: boolean): Promise<string>;
  claim(): Promise<{ stepId: string; kind: string }>;
  done(stepId: string, body: Record<string, unknown>): Promise<void>;
  uploadPlan(stepId: string, content: string): Promise<void>;
  confirm(buildId: string): Promise<void>;
  startReview(buildId: string, agentId?: string): Promise<Response>;
  merge(buildId: string): Promise<Response>;
  seedConvChanges(buildId: string): Promise<string>;
  todoRow(): ReturnType<typeof loadTodoRow>;
  stepsOf(buildId: string): ReturnType<typeof loadStepsOf>;
  bareMainTip(): Promise<string | null>;
}

function loadTodoRow(s: TestServer, todoId: string) {
  return s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
}
function loadStepsOf(s: TestServer, buildId: string) {
  return s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
}

async function setupWorld(opts: { hosted?: boolean } = {}): Promise<World> {
  const s = bootServer({ claimHoldMs: 200, pingIntervalMs: 3_600_000 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-702',
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
    body: { teamId: s.team.id, name: 'restore-mbp', cliVersion: '0.1.0' },
  });

  bindAllAgents(s);
  expect(enrollRes.status).toBe(200);
  const { token: machineToken } = (await enrollRes.json()) as { token: string };
  let projectId: string;
  if (opts.hosted) {
    const hostedRes = await call(s.app, 'POST', '/api/projects', {
      body: { name: 'restore-hosted', repoKind: 'hosted' },
    });
    expect(hostedRes.status).toBe(201);
    projectId = ((await hostedRes.json()) as { id: string }).id;
  } else {
    projectId = await postProject(s.app);
  }
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '恢复探针', spec: '走完 build 腿后让审核步失败' },
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
  async function startReview(buildId: string, agentId = REVIEW_AGENT_ID): Promise<Response> {
    return call(s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review', agentId },
    });
  }
  async function merge(buildId: string): Promise<Response> {
    return call(s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
  }
  async function seedConvChanges(buildId: string): Promise<string> {
    const projRow = s.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
    expect(projRow?.repoName).toBeTruthy();
    const bareDir = join(s.reposDir, s.team.id, `${projRow?.repoName}.git`);
    const dir = mkdtempSync(join(tmpdir(), 'cairn-702-'));
    dirs.push(dir);
    const repoDir = join(dir, 'repo');
    const git = async (args: string[]) => {
      const r = await runGit(args, { cwd: repoDir, env: GIT_ENV, timeoutMs: 60_000 });
      expect(r.code, r.stderr).toBe(0);
    };
    const clone = await runGit(['clone', bareDir, repoDir], { cwd: dir, env: GIT_ENV });
    expect(clone.code, clone.stderr).toBe(0);
    await git(['checkout', '-B', conversationBranch(buildId)]);
    writeFileSync(join(repoDir, 'probe.md'), '# restore probe\n');
    await git(['add', '-A']);
    await git(['commit', '-m', 'conv round']);
    await git(['push', 'origin', conversationBranch(buildId)]);
    const sha = await runGit(['rev-parse', 'HEAD'], { cwd: repoDir, env: GIT_ENV });
    expect(sha.code, sha.stderr).toBe(0);
    return sha.stdout.toString('utf8').trim();
  }
  async function bareMainTip(): Promise<string | null> {
    const projRow = s.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
    const bareDir = join(s.reposDir, s.team.id, `${projRow?.repoName}.git`);
    const r = await runGit(['rev-parse', 'refs/heads/main'], {
      cwd: bareDir,
      env: GIT_ENV,
      timeoutMs: 60_000,
    });
    return r.code === 0 ? r.stdout.toString('utf8').trim() : null;
  }

  return {
    s,
    todoId,
    projectId,
    machineToken,
    startBuild,
    claim,
    done,
    uploadPlan,
    confirm,
    startReview,
    merge,
    seedConvChanges,
    todoRow: () => loadTodoRow(s, todoId),
    stepsOf: (buildId: string) => loadStepsOf(s, buildId),
    bareMainTip,
  };
}

async function driveToDeadlock(
  w: World,
  opts: { buildCommit?: string | null } = {},
): Promise<string> {
  const buildId = await w.startBuild(true);
  const planClaimed = await w.claim();
  await w.uploadPlan(planClaimed.stepId, withVerification('# plan v1'));
  await w.done(planClaimed.stepId, { status: 'success', sessionId: 'pi-session-1' });
  await w.confirm(buildId);
  const buildClaimed = await w.claim();
  expect(buildClaimed.kind).toBe('build');
  const commit =
    opts.buildCommit === undefined ? await w.seedConvChanges(buildId) : opts.buildCommit;
  await w.done(buildClaimed.stepId, {
    status: 'success',
    sessionId: 'pi-session-1',
    hasChanges: true,
    ...(commit !== null ? { commit } : {}),
  });
  expect(w.todoRow().phase).toBe('review');
  const reviewRes = await w.startReview(buildId);
  expect(reviewRes.status).toBe(202);
  const reviewClaimed = await w.claim();
  expect(reviewClaimed.kind).toBe('review');
  await w.done(reviewClaimed.stepId, {
    status: 'failed',
    errorMessage: 'stream timeout (first=300000ms idle=480000ms)',
  });
  expect(w.todoRow().phase).toBe('failed');
  return buildId;
}

describe('#702 failed->review restore (B-C17 deadlock shape)', () => {
  describe('failure mode 1 positive: exit open (build delivered)', () => {
    let w: World;
    beforeEach(async () => {
      w = await setupWorld({ hosted: true });
    });

    test('#519 shape run through: build done + review failed -> in-product merge 202 -> merge step -> done (PR not orphaned)', async () => {
      try {
        const buildId = await driveToDeadlock(w);
        const buildStep = w
          .stepsOf(buildId)
          .filter((s) => s.kind === 'build')
          .at(-1)!;
        expect(buildStep.status).toBe('done');
        expect(buildStep.checkpointCommit).toBeTruthy();

        const mergeRes = await w.merge(buildId);
        expect(mergeRes.status).toBe(202);
        expect(await mergeRes.json()).toEqual({ delegated: true });
        expect(w.todoRow().phase).toBe('review');
        const mergeStep = w
          .stepsOf(buildId)
          .filter((s) => s.kind === 'merge')
          .at(-1);
        expect(mergeStep).toBeDefined();
        expect(mergeStep?.status).toBe('pending');

        const mergeClaimed = await w.claim();
        expect(mergeClaimed.kind).toBe('merge');
        const sha = buildStep.checkpointCommit!;
        await w.done(mergeClaimed.stepId, {
          status: 'success',
          sessionId: 'pi-session-1',
          commit: sha,
        });
        expect(w.todoRow().phase).toBe('done');
        expect(await w.bareMainTip()).toBe(sha);
      } finally {
        w.s.dispose();
      }
    });

    test('only rerun the review: failed (build leg done) starting an AI review -> 202 + review step enqueued + phase back to review', async () => {
      try {
        const buildId = await driveToDeadlock(w);
        const res = await w.startReview(buildId);
        expect(res.status).toBe(202);
        expect(w.todoRow().phase).toBe('review');
        const reviewSteps = w.stepsOf(buildId).filter((s) => s.kind === 'review');
        expect(reviewSteps).toHaveLength(2);
        expect(reviewSteps[0]?.status).toBe('failed');
        expect(reviewSteps[1]?.status).toBe('pending');
      } finally {
        w.s.dispose();
      }
    });
  });

  describe('failure mode 2 counterexample: half-finished build not allowed', () => {
    let w: World;
    beforeEach(async () => {
      w = await setupWorld();
    });

    test('build step itself failed (legs unfinished) -> merge 409 + review start 409', async () => {
      try {
        const buildId = await w.startBuild(false);
        const buildClaimed = await w.claim();
        await w.done(buildClaimed.stepId, {
          status: 'failed',
          errorMessage: '模型连接失败',
        });
        expect(w.todoRow().phase).toBe('failed');

        const mergeRes = await w.merge(buildId);
        expect(mergeRes.status).toBe(409);
        const reviewRes = await w.startReview(buildId);
        expect(reviewRes.status).toBe(409);
        expect(w.stepsOf(buildId).filter((s) => s.kind === 'merge')).toHaveLength(0);
      } finally {
        w.s.dispose();
      }
    });

    test('build done but zero artifacts (no commit, no PR) -> merge 409 + review start 409', async () => {
      try {
        const buildId = await driveToDeadlock(w, { buildCommit: null });
        const buildStep = w
          .stepsOf(buildId)
          .filter((s) => s.kind === 'build')
          .at(-1)!;
        expect(buildStep.status).toBe('done');
        expect(buildStep.checkpointCommit).toBeNull();
        const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
        expect(buildRow.prUrl).toBeNull();

        const mergeRes = await w.merge(buildId);
        expect(mergeRes.status).toBe(409);
        const reviewRes = await w.startReview(buildId);
        expect(reviewRes.status).toBe(409);
      } finally {
        w.s.dispose();
      }
    });
  });

  describe('failure mode 3: the new edge is not generalized', () => {
    let w: World;
    beforeEach(async () => {
      w = await setupWorld();
    });

    test('restore lands review not done; merge is still a 202 delegated merge step (human responsibility semantics in spec 02 section 4.2)', async () => {
      try {
        const buildId = await driveToDeadlock(w, { buildCommit: 'sha-702-probe' });
        const mergeRes = await w.merge(buildId);
        expect(mergeRes.status).toBe(202);
        expect(w.todoRow().phase).toBe('review');
        expect(w.stepsOf(buildId).filter((s) => s.kind === 'merge')).toHaveLength(1);
      } finally {
        w.s.dispose();
      }
    });

    test('manual phase-change surface does not accept this edge: PATCH phase=review (from failed) -> 409', async () => {
      try {
        await driveToDeadlock(w, { buildCommit: 'sha-702-probe' });
        expect(w.todoRow().phase).toBe('failed');
        const res = await call(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, {
          body: { phase: 'review' },
        });
        expect(res.status).toBe(409);
        expect(w.todoRow().phase).toBe('failed');
      } finally {
        w.s.dispose();
      }
    });
  });

  describe('failure mode 4: rerun semantics unchanged (failed->queued)', () => {
    let w: World;
    beforeEach(async () => {
      w = await setupWorld();
    });

    test('restart action as before: 202 + new build + phase queued (r3 section 3.7)', async () => {
      try {
        const buildId = await driveToDeadlock(w, { buildCommit: 'sha-702-probe' });
        expect(w.todoRow().phase).toBe('failed');
        const res = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
          body: {
            action: 'restart',
            feedback: '换条路再试',
            clientMessageId: '3f9a0c2e-0000-4000-8000-000000000070',
          },
        });
        expect(res.status).toBe(202);
        expect(w.todoRow().phase).toBe('queued');
        expect(w.todoRow().latestBuildId).not.toBe(buildId);
      } finally {
        w.s.dispose();
      }
    });
  });
});
