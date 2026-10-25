import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema, machineTokenResponseSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  agent as agentTable,
  apiKey as apiKeyTable,
  build as buildTable,
  message as messageTable,
  plan as planTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { systemGitOps } from '../src/lib/git.js';
import { MERGE_NOT_LANDED_NOTE } from '../src/services/machines.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  type TestServer,
  withVerification,
} from './helpers.js';

const AGENT_ID = 'agent-m3b-1';

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
      body: opts.body !== undefined ? JSON.stringify(opts.body) : (opts.text as string | undefined),
    }),
  );
}

interface GitWorld {
  s: TestServer;
  token: string;
  projectId: string;
  todoId: string;
  repoDir: string;
  startBuild(): Promise<string>;
  claim(): Promise<ClaimedStep>;
  done(stepId: string, body: Record<string, unknown>): Promise<Response>;
  uploadPlan(stepId: string, content: string): Promise<void>;
}

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

async function setupGitWorld(): Promise<GitWorld> {
  const s = bootServer({ claimHoldMs: 200 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'm3b-mbp', cliVersion: '0.1.0' },
  });
  const machineJson = (await enrollRes.json()) as { token: string };
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'm3b-builder',
      modelId: 'm',
      tools: ['合并分支', '推送分支'],
    })
    .run();
  bindAllAgents(s);
  const projRes = await call(s.app, 'POST', '/api/projects', {
    body: { name: 'm3b-lifecycle', repoKind: 'hosted' },
  });
  expect(projRes.status).toBe(201);
  const project = (await projRes.json()) as { id: string; repoName: string; cloneUrl: string };
  const todoRes = await call(s.app, 'POST', `/api/projects/${project.id}/todos`, {
    body: { title: 'M3b 探针', spec: '写一行探针到 README.md' },
  });
  const todoBody = (await todoRes.json()) as { id: string };
  const repoDir = join(s.reposDir, s.team.id, `${project.repoName}.git`);
  return {
    s,
    token: machineJson.token,
    projectId: project.id,
    todoId: todoBody.id,
    repoDir,
    async startBuild() {
      const res = await call(s.app, 'POST', `/api/projects/${project.id}/builds`, {
        body: {
          todoIds: [todoBody.id],
          assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
          withPlan: true,
        },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { builds: { id: string }[] };
      return body.builds[0]!.id;
    },
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: machineJson.token,
        body: {},
      });
      const body = (await res.json()) as { step: ClaimedStep | null };
      if (!body.step) throw new Error('claim returned no step');
      return claimedStepSchema.parse(body.step);
    },
    async done(stepId, body) {
      return call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: machineJson.token,
        body,
      });
    },
    async uploadPlan(stepId, content) {
      const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
        cred: machineJson.token,
        body: { files: [{ name: 'plan.md', size: content.length }] },
      });
      const urls = (await urlsRes.json()) as { uploads: { url: string }[] };
      const put = await call(s.app, 'PUT', urls.uploads[0]!.url.replace(/^https?:\/\/[^/]+/, ''), {
        cred: machineJson.token,
        text: content,
        contentType: 'text/markdown',
      });
      expect(put.status).toBe(200);
    },
  };
}

async function fakePushConvBranch(repoDir: string, branch: string): Promise<string> {
  const { runGit } = await import('../src/lib/git.js');
  const parent = await systemGitOps.resolveCommit(repoDir, 'refs/heads/main');
  if (parent === null) throw new Error('main missing');
  const treeRes = await runGit(['rev-parse', `${parent}^{tree}`], { cwd: repoDir });
  const tree = treeRes.stdout.toString('utf8').trim();
  const r = await runGit(
    ['commit-tree', tree, '-p', parent, '-m', `probe ${branch} ${Math.random()}`],
    {
      cwd: repoDir,
      env: {
        GIT_AUTHOR_NAME: 'it',
        GIT_AUTHOR_EMAIL: 'it@local',
        GIT_COMMITTER_NAME: 'it',
        GIT_COMMITTER_EMAIL: 'it@local',
      },
    },
  );
  if (r.code !== 0) throw new Error(`commit-tree failed: ${r.stderr}`);
  const sha = r.stdout.toString('utf8').trim();
  await systemGitOps.updateBranchRef(repoDir, branch, sha);
  return sha;
}

describe('claim payload repo binding slot (M3b worktree contract wiring, 02 section 3/5.5)', () => {
  test('hosted project -> project.repo {kind:hosted, cloneUrl=/git/<teamId>/<repoName>}', async () => {
    const w = await setupGitWorld();
    await w.startBuild();
    const claimed = await w.claim();
    expect(claimed.project!.repo?.kind).toBe('hosted');
    const url = new URL(claimed.project!.repo!.cloneUrl);
    expect(url.pathname).toBe(`/git/${w.s.team.id}/m3b-lifecycle`);
    const main = await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main');
    expect(main).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('per-step one-time git credential (02 section 5.4/8; relay tool name matches push_credential r5 section 3.1)', () => {
  test('token/{stepId} -> git {username,password}; revoked after done (revoke = row delete)', async () => {
    const w = await setupGitWorld();
    await w.startBuild();
    const claimed = await w.claim();
    const tokenRes = await call(w.s.app, 'GET', `/api/machine/token/${claimed.step.id}`, {
      cred: w.token,
    });
    const token = machineTokenResponseSchema.parse(await tokenRes.json());
    expect(token.git).not.toBeNull();
    expect(token.git?.username).toBe('git');
    expect(token.git?.password).toMatch(/^cairn_[0-9a-f]{48}$/);
    const rows = w.s.db
      .select()
      .from(apiKeyTable)
      .where(eq(apiKeyTable.name, `git-step-${claimed.step.id}`))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.gitAccess).toBe(true);
    expect(rows[0]!.keyHash).not.toContain(token.git!.password);
    const again = machineTokenResponseSchema.parse(
      await (
        await call(w.s.app, 'GET', `/api/machine/token/${claimed.step.id}`, { cred: w.token })
      ).json(),
    );
    expect(again.git?.password).not.toBe(token.git?.password);
    const rows2 = w.s.db
      .select()
      .from(apiKeyTable)
      .where(eq(apiKeyTable.name, `git-step-${claimed.step.id}`))
      .all();
    expect(rows2).toHaveLength(1);
    await w.done(claimed.step.id, { status: 'success', sessionId: 'pi-1' });
    const rows3 = w.s.db
      .select()
      .from(apiKeyTable)
      .where(eq(apiKeyTable.name, `git-step-${claimed.step.id}`))
      .all();
    expect(rows3).toHaveLength(0);
  });

  test('repo-less project -> git null (M3a compatible shape)', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    disposables.push(() => s.dispose());
    const key = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s.team.id, name: 'm3b-plain' },
    });
    const { token } = (await enroll.json()) as { token: string };
    s.db
      .insert(agentTable)
      .values({ id: AGENT_ID, teamId: s.team.id, displayName: 'b', modelId: 'm' })
      .run();
    bindAllAgents(s);

    const projRes = await call(s.app, 'POST', '/api/projects', { body: { name: 'plain' } });
    const project = (await projRes.json()) as { id: string };
    const todoRes = await call(s.app, 'POST', `/api/projects/${project.id}/todos`, {
      body: { title: 't', spec: 's' },
    });
    const todoBody = (await todoRes.json()) as { id: string };
    await call(s.app, 'POST', `/api/projects/${project.id}/builds`, {
      body: {
        todoIds: [todoBody.id],
        assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
        withPlan: true,
      },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep };
    expect(claimedStepSchema.parse(step).project!.repo).toBeNull();
    const tokenRes = await call(s.app, 'GET', `/api/machine/token/${step.step.id}`, {
      cred: token,
    });
    const parsed = machineTokenResponseSchema.parse(await tokenRes.json());
    expect(parsed.git).toBeNull();
  });
});

describe('plan.md artifact upload (02 section 4.2 / r5 section 4: plan is a file, version = file version)', () => {
  test('upload-urls plan.md -> plan v1 + build.planDocId; replan round -> v2', async () => {
    const w = await setupGitWorld();
    const buildId = await w.startBuild();
    const claimed = await w.claim();
    const stepId = claimed.step.id;

    const put = async (name: string, text: string) => {
      const urlsRes = await call(w.s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
        cred: w.token,
        body: { files: [{ name, size: text.length }] },
      });
      const urls = (await urlsRes.json()) as {
        uploads: { name: string; url: string }[];
      };
      const upload = urls.uploads[0]!;
      const res = await call(w.s.app, 'PUT', upload.url.replace(/^https?:\/\/[^/]+/, ''), {
        cred: w.token,
        text,
        contentType: 'text/markdown',
      });
      expect(res.status).toBe(200);
    };

    await put('plan.md', withVerification('# Context\n方案 v1\n'));
    const plans = w.s.db.select().from(planTable).where(eq(planTable.buildId, buildId)).all();
    expect(plans).toHaveLength(1);
    expect(plans[0]!.version).toBe(1);
    expect(plans[0]!.content).toContain('方案 v1');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.planDocId).toBe(plans[0]!.id);

    await put('plan.md', '# Context\n方案 v2\n');
    const plans2 = w.s.db.select().from(planTable).where(eq(planTable.buildId, buildId)).all();
    expect(plans2).toHaveLength(2);
    expect(plans2.map((p) => p.version).sort()).toEqual([1, 2]);
    const buildRow2 = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow2.planDocId).toBe(plans2.find((p) => p.version === 2)!.id);
  });
});

describe('done commit report = per-step checkpoint (r3 section 3.5 "restore here" data surface)', () => {
  test('step.checkpointCommit persisted', async () => {
    const w = await setupGitWorld();
    await w.startBuild();
    const claimed = await w.claim();
    const sha = 'a'.repeat(40);
    await w.done(claimed.step.id, { status: 'success', sessionId: 'pi-1', commit: sha });
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, claimed.step.id)).get()!;
    expect(row.checkpointCommit).toBe(sha);
  });
});

describe('merge 202 delegated -> merge step lands (02 section 4.2/A6; r3 section 3.6 server-side main verify)', () => {
  test('merge step done(commit) -> bare repo main fast-forward + timeline 🎉', async () => {
    const w = await setupGitWorld();
    const buildId = await w.startBuild();
    const planStep = await w.claim();
    await w.uploadPlan(planStep.step.id, withVerification('# Context\n方案 v1\n'));
    await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { body: { action: 'confirm' } });
    const buildStep = await w.claim();
    const convSha = await fakePushConvBranch(w.repoDir, `cairn/conv-${buildId}`);
    await w.done(buildStep.step.id, {
      status: 'success',
      sessionId: 'pi-1',
      hasChanges: true,
      commit: convSha,
    });
    const todoNow = () => w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoNow().phase).toBe('review');

    const mergeRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    expect(mergeRes.status).toBe(202);
    expect(await mergeRes.json()).toEqual({ delegated: true });
    const msgsAfterRequest = w.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(msgsAfterRequest.some((m) => m.content === '发起了合并')).toBe(true);

    const mergeStep = await w.claim();
    expect(mergeStep.step.kind).toBe('merge');
    expect(mergeStep.session.action).toBe('continue');
    await w.done(mergeStep.step.id, {
      status: 'success',
      sessionId: 'pi-1',
      commit: convSha,
    });
    expect(todoNow().phase).toBe('done');
    const main = await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main');
    expect(main).toBe(convSha);
    const msgs = w.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(msgs.some((m) => m.content === '🎉 任务已完成')).toBe(true);
  });

  test('not fast-forward (main advanced during the merge window) -> step failed + todo failed (failure only human rerun, 02/A6)', async () => {
    const w = await setupGitWorld();
    const buildId = await w.startBuild();
    const planStep = await w.claim();
    await w.uploadPlan(planStep.step.id, withVerification('# Context\n方案 v1\n'));
    await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { body: { action: 'confirm' } });
    const buildStep = await w.claim();
    const convSha = await fakePushConvBranch(w.repoDir, `cairn/conv-${buildId}`);
    await w.done(buildStep.step.id, { status: 'success', sessionId: 'pi-1', commit: convSha });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    const mergeStep = await w.claim();
    await fakePushConvBranch(w.repoDir, 'main');
    await w.done(mergeStep.step.id, { status: 'success', sessionId: 'pi-1', commit: convSha });

    const stepRow = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, mergeStep.step.id))
      .get()!;
    expect(stepRow.status).toBe('failed');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('failed');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toContain('non-fast-forward');
  });
});

describe('#1487 merge step in flight when the card leaves review: success report not landed; repeated merge request 409', () => {
  async function mergeInFlight() {
    const w = await setupGitWorld();
    const buildId = await w.startBuild();
    const planStep = await w.claim();
    await w.uploadPlan(planStep.step.id, withVerification('# Context\n方案 v1\n'));
    await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { body: { action: 'confirm' } });
    const buildStep = await w.claim();
    const convSha = await fakePushConvBranch(w.repoDir, `cairn/conv-${buildId}`);
    await w.done(buildStep.step.id, {
      status: 'success',
      sessionId: 'pi-1',
      hasChanges: true,
      commit: convSha,
    });
    const mainBefore = await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main');
    expect((await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} })).status).toBe(
      202,
    );
    const mergeStep = await w.claim();
    expect(mergeStep.step.kind).toBe('merge');
    return { w, buildId, convSha, mergeStepId: mergeStep.step.id, mainBefore };
  }
  const phaseOf = (w: Awaited<ReturnType<typeof setupGitWorld>>) =>
    w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!.phase;
  const timeline = (w: Awaited<ReturnType<typeof setupGitWorld>>, buildId: string) =>
    w.s.db.select().from(messageTable).where(eq(messageTable.conversationId, buildId)).all();

  test('failure mode 1: closed while the merge step is in flight -> success report does not fast-forward main, card still closed, timeline explanation', async () => {
    const { w, buildId, convSha, mergeStepId, mainBefore } = await mergeInFlight();
    expect(
      (await call(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { body: { phase: 'closed' } }))
        .status,
    ).toBe(200);
    await w.done(mergeStepId, { status: 'success', sessionId: 'pi-1', commit: convSha });
    expect(await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main')).toBe(mainBefore);
    expect(phaseOf(w)).toBe('closed');
    expect(timeline(w, buildId).some((m) => m.content === MERGE_NOT_LANDED_NOTE)).toBe(true);
    expect(timeline(w, buildId).some((m) => m.content === '🎉 任务已完成')).toBe(false);
  });

  test('failure mode 1b: report arrives while card still in review, closed during the landing git check -> still not fast-forwarded', async () => {
    const { w, buildId, convSha, mergeStepId, mainBefore } = await mergeInFlight();
    const real = systemGitOps.listBranches.bind(systemGitOps);
    let closedInWindow = false;
    const spy = vi.spyOn(systemGitOps, 'listBranches').mockImplementation(async (...args) => {
      closedInWindow = true;
      await call(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { body: { phase: 'closed' } });
      return real(...args);
    });
    try {
      await w.done(mergeStepId, { status: 'success', sessionId: 'pi-1', commit: convSha });
    } finally {
      spy.mockRestore();
    }
    expect(closedInWindow).toBe(true);
    expect(await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main')).toBe(mainBefore);
    expect(phaseOf(w)).toBe('closed');
    expect(timeline(w, buildId).some((m) => m.content === MERGE_NOT_LANDED_NOTE)).toBe(true);
  });

  test('failure mode 2: closed then reopened to to-do -> also not landed, card still todo', async () => {
    const { w, buildId, convSha, mergeStepId, mainBefore } = await mergeInFlight();
    expect(
      (await call(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { body: { phase: 'closed' } }))
        .status,
    ).toBe(200);
    expect(
      (await call(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { body: { phase: 'todo' } })).status,
    ).toBe(200);
    await w.done(mergeStepId, { status: 'success', sessionId: 'pi-1', commit: convSha });
    expect(await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main')).toBe(mainBefore);
    expect(phaseOf(w)).toBe('todo');
    expect(timeline(w, buildId).some((m) => m.content === MERGE_NOT_LANDED_NOTE)).toBe(true);
  });

  test('failure mode 3: same build already has an in-flight merge step (pending or claimed) -> another merge request 409, no extra one queued', async () => {
    const w = await setupGitWorld();
    const buildId = await w.startBuild();
    const planStep = await w.claim();
    await w.uploadPlan(planStep.step.id, withVerification('# Context\n方案 v1\n'));
    await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { body: { action: 'confirm' } });
    const buildStep = await w.claim();
    const convSha = await fakePushConvBranch(w.repoDir, `cairn/conv-${buildId}`);
    await w.done(buildStep.step.id, {
      status: 'success',
      sessionId: 'pi-1',
      hasChanges: true,
      commit: convSha,
    });
    expect((await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} })).status).toBe(
      202,
    );
    expect((await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} })).status).toBe(
      409,
    );
    await w.claim();
    expect((await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} })).status).toBe(
      409,
    );
    const mergeSteps = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, buildId))
      .all()
      .filter((r) => r.kind === 'merge');
    expect(mergeSteps).toHaveLength(1);
  });
});

describe('hosted repo provision seed commit (M3b [design]: empty repo cannot worktree)', () => {
  test('init bare immediately establishes refs/heads/main (empty-tree seed)', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cairn-seed-')), 'x.git');
    disposables.push(() => rmSync(dir, { recursive: true, force: true }));
    await systemGitOps.initBareRepo(dir);
    expect(await systemGitOps.resolveCommit(dir, 'refs/heads/main')).toBeNull();
    const sha = await systemGitOps.seedInitialCommit(dir, 'init x');
    expect(await systemGitOps.resolveCommit(dir, 'refs/heads/main')).toBe(sha);
    expect(await systemGitOps.isAncestor(dir, sha, sha)).toBe(true);
  });
});
