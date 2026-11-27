import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema, machineTokenResponseSchema } from '@cairn/shared';
import { and, eq, like, ne } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  apiKey as apiKeyTable,
  build as buildTable,
  machine as machineTable,
  message as messageTable,
  plan as planTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { systemGitOps } from '../src/lib/git.js';
import { createApiKey } from '../src/services/api-keys.js';
import { sweepAbandonedBuildSteps } from '../src/services/build-abandoned-sweep.js';
import { resolveGitAuth } from '../src/services/credentials.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { MERGE_NOT_LANDED_NOTE, sweepStaleMachines } from '../src/services/machines.js';
import { stubGithubApp } from './github-identity-fixture.js';
import {
  bootServer,
  claimedGeneration,
  dropQueuedVerify,
  issueApiKey,
  seedSessionRoute,
  startLegacyBuild,
  type TestServer,
  withVerification,
} from './helpers.js';

const GIT_TOOLS = ['合并分支', '推送分支'];

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
  startBuild(): string;
  claim(): Promise<ClaimedStep>;
  done(stepId: string, body: Record<string, unknown>): Promise<Response>;
  uploadPlan(stepId: string, content: string): Promise<void>;
}

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

async function setupGitWorld(opts: Parameters<typeof bootServer>[0] = {}): Promise<GitWorld> {
  const s = bootServer({ claimHoldMs: 200, ...opts });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({
      teamId: s.team.id,
      name: 'm3b-mbp',
      cliVersion: '0.1.0',
      capabilities: { mcpServers: [], skills: [], claimGeneration: true },
    }),
  });
  const machineJson = (await enrollRes.json()) as { token: string };
  seedSessionRoute(s, {
    provider: 'stub-gw',
    modelId: 'm',
    machineId: s.db.select().from(machineTable).get()!.id,
    tools: GIT_TOOLS,
  });
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
    startBuild() {
      return startLegacyBuild(s, todoBody.id, { withPlan: true });
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
        body: { generation: claimedGeneration(s.db, stepId), ...body },
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
    w.startBuild();
    const claimed = await w.claim();
    expect(claimed.project!.repo?.kind).toBe('hosted');
    const url = new URL(claimed.project!.repo!.cloneUrl);
    expect(url.pathname).toBe(`/git/${w.s.team.id}/m3b-lifecycle`);
    const main = await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main');
    expect(main).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('per-step one-time git credential (02 section 5.4/8; relay tool name matches push_credential r5 section 3.1)', () => {
  test('token/{stepId} -> git {username,password}, the same credential on every call while claimed; revoked after done (revoke = row delete)', async () => {
    const w = await setupGitWorld();
    w.startBuild();
    const claimed = await w.claim();
    const tokenRes = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
      {
        cred: w.token,
      },
    );
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
        await call(
          w.s.app,
          'GET',
          `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
          { cred: w.token },
        )
      ).json(),
    );
    expect(again.git?.password).toBe(token.git?.password);
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

  test('step git key stays out of the API key list and stops opening git once its step is no longer running', async () => {
    const w = await setupGitWorld();
    w.startBuild();
    const claimed = await w.claim();
    const token = machineTokenResponseSchema.parse(
      await (
        await call(
          w.s.app,
          'GET',
          `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
          { cred: w.token },
        )
      ).json(),
    );
    const listed = (await (
      await call(w.s.app, 'GET', `/api/teams/${w.s.team.id}/api-keys`)
    ).json()) as { name: string | null }[];
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.map((key) => key.name)).not.toContain(`git-step-${claimed.step.id}`);
    const infoRefs = () =>
      w.s.app.request(`/git/${w.s.team.id}/m3b-lifecycle/info/refs?service=git-upload-pack`, {
        headers: {
          authorization: `Basic ${Buffer.from(`git:${token.git!.password}`).toString('base64')}`,
        },
      });
    expect((await infoRefs()).status).toBe(200);
    w.s.db
      .update(stepTable)
      .set({ status: 'stopped' })
      .where(eq(stepTable.id, claimed.step.id))
      .run();
    expect((await infoRefs()).status).toBe(401);
  });

  test('keys sharing the step-key name authorize by their own row: a decoy git-step- row neither sinks nor rescues the real credential', async () => {
    const w = await setupGitWorld();
    w.startBuild();
    const claimed = await w.claim();
    const name = `git-step-${claimed.step.id}`;
    const token = machineTokenResponseSchema.parse(
      await (
        await call(
          w.s.app,
          'GET',
          `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
          { cred: w.token },
        )
      ).json(),
    );
    const decoy = createApiKey(w.s, {
      teamId: w.s.team.id,
      name,
      gitAccess: true,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
    });
    const infoRefs = (secret: string) =>
      w.s.app.request(`/git/${w.s.team.id}/m3b-lifecycle/info/refs?service=git-upload-pack`, {
        headers: {
          authorization: `Basic ${Buffer.from(`git:${secret}`).toString('base64')}`,
        },
      });
    expect((await infoRefs(token.git!.password)).status).toBe(200);
    expect((await infoRefs(decoy.plaintext)).status).toBe(401);
    const generation = w.s.db
      .select({ claimedAt: stepTable.claimedAt })
      .from(stepTable)
      .where(eq(stepTable.id, claimed.step.id))
      .get()!.claimedAt;
    expect(generation).not.toBeNull();
    const real = w.s.db
      .select({ id: apiKeyTable.id })
      .from(apiKeyTable)
      .where(and(eq(apiKeyTable.name, name), ne(apiKeyTable.id, decoy.id)))
      .get()!;
    w.s.db
      .update(apiKeyTable)
      .set({ claimGeneration: generation })
      .where(eq(apiKeyTable.id, decoy.id))
      .run();
    w.s.db
      .update(apiKeyTable)
      .set({ claimGeneration: null })
      .where(eq(apiKeyTable.id, real.id))
      .run();
    expect((await infoRefs(token.git!.password)).status).toBe(401);
    expect((await infoRefs(decoy.plaintext)).status).toBe(200);
  });

  test('a git key deleted between the hash match and the scope read fails closed, never an unnamed key', async () => {
    const w = await setupGitWorld();
    w.startBuild();
    const claimed = await w.claim();
    const token = machineTokenResponseSchema.parse(
      await (
        await call(
          w.s.app,
          'GET',
          `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
          { cred: w.token },
        )
      ).json(),
    );
    const name = `git-step-${claimed.step.id}`;
    const realId = w.s.db
      .select({ id: apiKeyTable.id })
      .from(apiKeyTable)
      .where(eq(apiKeyTable.name, name))
      .get()!.id;
    const infoRefs = () =>
      w.s.app.request(`/git/${w.s.team.id}/m3b-lifecycle/info/refs?service=git-upload-pack`, {
        headers: {
          authorization: `Basic ${Buffer.from(`git:${token.git!.password}`).toString('base64')}`,
        },
      });
    expect((await infoRefs()).status).toBe(200);
    const secretHash = Buffer.from(sha256Hex(token.git!.password));
    expect(resolveGitAuth(w.s.db, secretHash)).toMatchObject({
      keyId: realId,
      stepScope: { projectId: w.projectId },
    });
    w.s.db.delete(apiKeyTable).where(eq(apiKeyTable.id, realId)).run();
    expect(resolveGitAuth(w.s.db, secretHash)).toBeNull();
    expect((await infoRefs()).status).toBe(401);
  });

  test('a step key on a released claim resolves to no scope at all', async () => {
    const w = await setupGitWorld();
    w.startBuild();
    const claimed = await w.claim();
    const token = machineTokenResponseSchema.parse(
      await (
        await call(
          w.s.app,
          'GET',
          `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
          { cred: w.token },
        )
      ).json(),
    );
    w.s.db
      .update(stepTable)
      .set({ status: 'stopped' })
      .where(eq(stepTable.id, claimed.step.id))
      .run();
    expect(resolveGitAuth(w.s.db, Buffer.from(sha256Hex(token.git!.password)))).toBeNull();
  });

  describe('step git key scope', () => {
    const zero = '0'.repeat(40);
    const oid = 'a'.repeat(40);
    const pkt = (text: string) => `${(text.length + 4).toString(16).padStart(4, '0')}${text}`;
    const pushBody = (ref: string, old = zero) =>
      `${pkt(`${old} ${oid} ${ref}\0 report-status\n`)}0000`;

    async function stepKeyWorld() {
      const w = await setupGitWorld();
      w.startBuild();
      const claimed = await w.claim();
      const token = machineTokenResponseSchema.parse(
        await (
          await call(
            w.s.app,
            'GET',
            `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
            { cred: w.token },
          )
        ).json(),
      );
      const auth = `Basic ${Buffer.from(`git:${token.git!.password}`).toString('base64')}`;
      const buildId = w.s.db
        .select({ buildId: stepTable.buildId })
        .from(stepTable)
        .where(eq(stepTable.id, claimed.step.id))
        .get()!.buildId;
      const push = (ref: string, old?: string) =>
        w.s.app.request(`/git/${w.s.team.id}/m3b-lifecycle/git-receive-pack`, {
          method: 'POST',
          headers: {
            authorization: auth,
            'content-type': 'application/x-git-receive-pack-request',
          },
          body: pushBody(ref, old),
        });
      return { w, auth, buildId, push, claimed, token };
    }

    test('a step key cannot push the default branch or any branch but its own work branch', async () => {
      const { push, buildId } = await stepKeyWorld();
      expect((await push('refs/heads/main')).status).toBe(403);
      expect((await push('refs/heads/other')).status).toBe(403);
      expect((await push(`refs/heads/cairn/conv-${buildId}x`)).status).toBe(403);
      expect((await push(`refs/heads/cairn/conv-${buildId}`, oid)).status).not.toBe(403);
      expect((await push(`refs/heads/cairn/conv-${buildId}`)).status).not.toBe(403);
      expect((await push('refs/tags/v1')).status).not.toBe(403);
      expect((await push('refs/tags/v1', oid)).status).toBe(403);
    });

    test('a step key opens only its own project repo', async () => {
      const { w, auth } = await stepKeyWorld();
      const other = await call(w.s.app, 'POST', '/api/projects', {
        body: { name: 'other-repo', repoKind: 'hosted' },
      });
      expect(other.status).toBe(201);
      const refs = (name: string) =>
        w.s.app.request(`/git/${w.s.team.id}/${name}/info/refs?service=git-upload-pack`, {
          headers: { authorization: auth },
        });
      expect((await refs('m3b-lifecycle')).status).toBe(200);
      expect((await refs('other-repo')).status).toBe(404);
    });

    test('a step key stops working when the claim generation moves under it', async () => {
      const { w, auth, claimed } = await stepKeyWorld();
      const refs = () =>
        w.s.app.request(`/git/${w.s.team.id}/m3b-lifecycle/info/refs?service=git-upload-pack`, {
          headers: { authorization: auth },
        });
      expect((await refs()).status).toBe(200);
      w.s.db
        .update(stepTable)
        .set({ claimedAt: claimed.step.generation! + 1 })
        .where(eq(stepTable.id, claimed.step.id))
        .run();
      expect((await refs()).status).toBe(401);
    });

    test('a step key whose claim is released while the push body is read never reaches the backend', async () => {
      const { w, push, claimed, buildId } = await stepKeyWorld();
      const backend = vi.spyOn(systemGitOps, 'httpBackend');
      const realArrayBuffer = Request.prototype.arrayBuffer;
      const reader = vi
        .spyOn(Request.prototype, 'arrayBuffer')
        .mockImplementationOnce(async function (this: Request) {
          const buf = await realArrayBuffer.call(this);
          w.s.db
            .update(stepTable)
            .set({ status: 'pending', machineId: null })
            .where(eq(stepTable.id, claimed.step.id))
            .run();
          return buf;
        });
      try {
        const res = await push(`refs/heads/cairn/conv-${buildId}`);
        expect(reader).toHaveBeenCalledTimes(1);
        expect(res.status).toBe(401);
        expect(backend).not.toHaveBeenCalled();
      } finally {
        reader.mockRestore();
        backend.mockRestore();
      }
    });

    test('asking for the token again keeps the credential the runner already holds working', async () => {
      const { w, auth, claimed, token } = await stepKeyWorld();
      const again = machineTokenResponseSchema.parse(
        await (
          await call(
            w.s.app,
            'GET',
            `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
            { cred: w.token },
          )
        ).json(),
      );
      expect(again.git?.password).toBe(token.git?.password);
      const res = await w.s.app.request(
        `/git/${w.s.team.id}/m3b-lifecycle/info/refs?service=git-upload-pack`,
        { headers: { authorization: auth } },
      );
      expect(res.status).toBe(200);
    });
  });

  async function claimWithStepKey(w: GitWorld): Promise<string> {
    w.startBuild();
    const claimed = await w.claim();
    await call(
      w.s.app,
      'GET',
      `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
      { cred: w.token },
    );
    expect(stepKeyNames(w)).toEqual([`git-step-${claimed.step.id}`]);
    return claimed.step.id;
  }

  function stepKeyNames(w: GitWorld): (string | null)[] {
    return w.s.db
      .select({ name: apiKeyTable.name })
      .from(apiKeyTable)
      .where(like(apiKeyTable.name, 'git-step-%'))
      .all()
      .map((row) => row.name);
  }

  function stepStatus(w: GitWorld, stepId: string): string | undefined {
    return w.s.db
      .select({ status: stepTable.status })
      .from(stepTable)
      .where(eq(stepTable.id, stepId))
      .get()?.status;
  }

  const LATER = () => Date.now() + 24 * 60 * 60_000;

  test('a step released after its machine went offline loses its git key', async () => {
    const w = await setupGitWorld();
    const stepId = await claimWithStepKey(w);
    sweepStaleMachines(w.s.svc, LATER());
    sweepAbandonedBuildSteps(w.s.svc, LATER());
    expect(stepStatus(w, stepId)).toBe('pending');
    expect(stepKeyNames(w)).toEqual([]);
  });

  test('a step the abandoned sweep stops loses its git key, and asking for its token again issues none', async () => {
    const w = await setupGitWorld();
    const stepId = await claimWithStepKey(w);
    w.s.db
      .update(todoTable)
      .set({ archivedAt: Date.now() })
      .where(eq(todoTable.id, w.todoId))
      .run();
    sweepAbandonedBuildSteps(w.s.svc, LATER());
    expect(stepStatus(w, stepId)).toBe('stopped');
    expect(stepKeyNames(w)).toEqual([]);
    const again = await call(w.s.app, 'GET', `/api/machine/token/${stepId}`, { cred: w.token });
    expect(again.status).toBe(409);
    expect(stepKeyNames(w)).toEqual([]);
  });

  test('deleting the task removes its running step and that step git key', async () => {
    const w = await setupGitWorld();
    const stepId = await claimWithStepKey(w);
    expect((await call(w.s.app, 'DELETE', `/api/todos/${w.todoId}`)).status).toBeLessThan(300);
    expect(stepStatus(w, stepId)).toBeUndefined();
    expect(stepKeyNames(w)).toEqual([]);
  });

  test('repo-less project -> git null (M3a compatible shape)', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    disposables.push(() => s.dispose());
    const key = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: readyMachine({ teamId: s.team.id, name: 'm3b-plain' }),
    });
    const { token } = (await enroll.json()) as { token: string };
    seedSessionRoute(s, {
      provider: 'stub-gw',
      modelId: 'm',
      machineId: s.db.select().from(machineTable).get()!.id,
    });

    const projRes = await call(s.app, 'POST', '/api/projects', { body: { name: 'plain' } });
    const project = (await projRes.json()) as { id: string };
    const todoRes = await call(s.app, 'POST', `/api/projects/${project.id}/todos`, {
      body: { title: 't', spec: 's' },
    });
    const todoBody = (await todoRes.json()) as { id: string };
    startLegacyBuild(s, todoBody.id, { withPlan: true });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep };
    expect(claimedStepSchema.parse(step).project!.repo).toBeNull();
    const tokenRes = await call(
      s.app,
      'GET',
      `/api/machine/token/${step.step.id}?generation=${step.step.generation}`,
      { cred: token },
    );
    const parsed = machineTokenResponseSchema.parse(await tokenRes.json());
    expect(parsed.git).toBeNull();
  });
});

describe('plan.md artifact upload (02 section 4.2 / r5 section 4: plan is a file, version = file version)', () => {
  test('upload-urls plan.md -> plan v1 + build.planDocId; replan round -> v2', async () => {
    const w = await setupGitWorld();
    const buildId = w.startBuild();
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
    w.startBuild();
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
    const buildId = w.startBuild();
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
    dropQueuedVerify(w.s, buildId);
    const todoNow = () => w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoNow().phase).toBe('done');

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

  test('a non-fast-forward merge fails without undoing delivery or moving main', async () => {
    const w = await setupGitWorld();
    const buildId = w.startBuild();
    const planStep = await w.claim();
    await w.uploadPlan(planStep.step.id, withVerification('# Context\n方案 v1\n'));
    await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { body: { action: 'confirm' } });
    const buildStep = await w.claim();
    const convSha = await fakePushConvBranch(w.repoDir, `cairn/conv-${buildId}`);
    await w.done(buildStep.step.id, { status: 'success', sessionId: 'pi-1', commit: convSha });
    dropQueuedVerify(w.s, buildId);
    await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    const mergeStep = await w.claim();
    const mainAdvanced = await fakePushConvBranch(w.repoDir, 'main');
    await w.done(mergeStep.step.id, { status: 'success', sessionId: 'pi-1', commit: convSha });

    const stepRow = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, mergeStep.step.id))
      .get()!;
    expect(stepRow.status).toBe('failed');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('done');
    expect(await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main')).toBe(mainAdvanced);
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toContain('non-fast-forward');
  });
});

describe('#1487 legacy review cancellation and duplicate explicit merges', () => {
  async function mergeInFlight() {
    const w = await setupGitWorld();
    const buildId = w.startBuild();
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
    dropQueuedVerify(w.s, buildId);
    const delivered = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(delivered.phase).toBe('done');
    w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, w.todoId)).run();
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
    const completionNotices = timeline(w, buildId).filter((m) => m.content === '🎉 任务已完成');
    expect(
      (await call(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { body: { phase: 'closed' } }))
        .status,
    ).toBe(200);
    await w.done(mergeStepId, { status: 'success', sessionId: 'pi-1', commit: convSha });
    expect(await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main')).toBe(mainBefore);
    expect(phaseOf(w)).toBe('closed');
    expect(timeline(w, buildId).some((m) => m.content === MERGE_NOT_LANDED_NOTE)).toBe(true);
    expect(timeline(w, buildId).filter((m) => m.content === '🎉 任务已完成')).toEqual(
      completionNotices,
    );
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
    const buildId = w.startBuild();
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
    dropQueuedVerify(w.s, buildId);
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
    const dir = join(makeTestTempDir('cairn-seed-'), 'x.git');
    disposables.push(() => rmSync(dir, { recursive: true, force: true }));
    await systemGitOps.initBareRepo(dir);
    expect(await systemGitOps.resolveCommit(dir, 'refs/heads/main')).toBeNull();
    const sha = await systemGitOps.seedInitialCommit(dir, 'init x');
    expect(await systemGitOps.resolveCommit(dir, 'refs/heads/main')).toBe(sha);
    expect(await systemGitOps.isAncestor(dir, sha, sha)).toBe(true);
  });
});

test('GitHub step credential uses the minted App identity', async () => {
  const w = await setupGitWorld({
    githubFetch: async () => Response.json({ id: 4242, full_name: 'owner/repo' }),
  });
  w.s.db
    .update(projectTable)
    .set({ repoKind: 'github', githubRepo: 'owner/repo' })
    .where(eq(projectTable.id, w.projectId))
    .run();
  const app = stubGithubApp(null);
  w.startBuild();
  const claimed = await w.claim();
  const pin = w.s.db.select().from(stepTable).where(eq(stepTable.id, claimed.step.id)).get();
  expect(pin?.claimedRepo).toBe('owner/repo');
  expect(pin?.claimedRepoId).toBe(4242);
  const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  try {
    const response = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
      {
        cred: w.token,
      },
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).not.toHaveProperty('coAuthor');
    const result = machineTokenResponseSchema.parse(payload);
    expect(result.git?.password).toBe(app);
    expect(result.git?.kind).toBe('app');
    expect((result.git?.expiresAt ?? 0) - Date.now()).toBeGreaterThan(50 * 60000);
    expect(info).toHaveBeenCalledWith(
      'github step credential',
      expect.objectContaining({ kind: 'app' }),
    );
  } finally {
    vi.restoreAllMocks();
  }
});

test('a runner whose App credential is repo-not-installed gets a clear refusal, never the team OAuth token', async () => {
  const w = await setupGitWorld({
    githubFetch: async () => Response.json({ id: 4242, full_name: 'owner/repo' }),
  });
  w.s.db
    .update(projectTable)
    .set({ repoKind: 'github', githubRepo: 'owner/repo' })
    .where(eq(projectTable.id, w.projectId))
    .run();
  upsertGithubConnection(
    { db: w.s.db, box: w.s.secretBox },
    {
      teamId: w.s.team.id,
      login: 'human',
      githubUserId: 12,
      githubName: 'Human',
      accessToken: 'identity-test-user',
      scope: 'repo',
    },
  );
  w.startBuild();
  const claimed = await w.claim();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  stubGithubApp('repo-not-installed');
  try {
    const response = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
      {
        cred: w.token,
      },
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body.includes('identity-test-user')).toBe(false);
    expect(body.includes('repo-not-installed')).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});

test('a runner with no App socket configured receives git null, never the team OAuth token', async () => {
  const w = await setupGitWorld({
    githubFetch: async () => Response.json({ id: 4242, full_name: 'owner/repo' }),
  });
  w.s.db
    .update(projectTable)
    .set({ repoKind: 'github', githubRepo: 'owner/repo' })
    .where(eq(projectTable.id, w.projectId))
    .run();
  upsertGithubConnection(
    { db: w.s.db, box: w.s.secretBox },
    {
      teamId: w.s.team.id,
      login: 'human',
      githubUserId: 12,
      githubName: 'Human',
      accessToken: 'identity-test-user',
      scope: 'repo',
    },
  );
  w.startBuild();
  const claimed = await w.claim();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  try {
    const response = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
      {
        cred: w.token,
      },
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body.includes('identity-test-user')).toBe(false);
    const result = machineTokenResponseSchema.parse(JSON.parse(body));
    expect(result.git).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      'github step credential',
      expect.objectContaining({ kind: 'none' }),
    );
  } finally {
    vi.restoreAllMocks();
  }
});

test('a runner with an App socket configured still fails closed if mint reports app-token-unconfigured', async () => {
  const w = await setupGitWorld({
    githubAppTokenSocket: '/tmp/configured-mint.sock',
    githubFetch: async () => Response.json({ id: 4242, full_name: 'owner/repo' }),
  });
  w.s.db
    .update(projectTable)
    .set({ repoKind: 'github', githubRepo: 'owner/repo' })
    .where(eq(projectTable.id, w.projectId))
    .run();
  upsertGithubConnection(
    { db: w.s.db, box: w.s.secretBox },
    {
      teamId: w.s.team.id,
      login: 'human',
      githubUserId: 12,
      githubName: 'Human',
      accessToken: 'identity-test-user',
      scope: 'repo',
    },
  );
  w.startBuild();
  const claimed = await w.claim();
  stubGithubApp('app-token-unconfigured');
  try {
    const response = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
      {
        cred: w.token,
      },
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body.includes('identity-test-user')).toBe(false);
    expect(body.includes('app-token-unconfigured')).toBe(true);
  } finally {
    vi.restoreAllMocks();
  }
});

describe('github app-configured step credential fails closed', () => {
  test.each([404, 502])(
    'scoped mint answered %s -> token endpoint errors and never sends another credential',
    async (mintStatus) => {
      const mintDir = makeTestTempDir('m3b-mint-');
      disposables.push(() => rmSync(mintDir, { recursive: true, force: true }));
      const socketPath = join(mintDir, 'mint.sock');
      const urls: string[] = [];
      const mint = createServer((req, res) => {
        urls.push(req.url ?? '');
        res.setHeader('content-type', 'application/json');
        const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
        if (!params.has('repository')) {
          res.end(
            JSON.stringify({
              token: 'membership-listing',
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
              installationId: 7,
              appSlug: 'cairnwright',
              permissions: { metadata: 'read' },
            }),
          );
          return;
        }
        res.statusCode = mintStatus;
        res.end('{}');
      });
      await new Promise<void>((resolve) => mint.listen(socketPath, resolve));
      disposables.push(() => {
        mint.close();
      });
      const w = await setupGitWorld({
        githubAppTokenSocket: socketPath,
        githubFetch: async () => Response.json({ id: 4242, full_name: 'owner/repo' }),
      });
      w.s.db
        .update(projectTable)
        .set({ repoKind: 'github', githubRepo: 'owner/repo' })
        .where(eq(projectTable.id, w.projectId))
        .run();
      upsertGithubConnection(
        { db: w.s.db, box: w.s.secretBox },
        {
          teamId: w.s.team.id,
          login: 'human',
          githubUserId: 12,
          githubName: 'Human',
          accessToken: 'identity-test-user',
          scope: 'repo',
        },
      );
      w.startBuild();
      const claimed = await w.claim();
      const response = await call(
        w.s.app,
        'GET',
        `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
        {
          cred: w.token,
        },
      );
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body.includes('identity-test-user')).toBe(false);
      expect(body.includes('membership-listing')).toBe(false);
      expect(urls.some((url) => url === '/token')).toBe(false);
      expect(urls.some((url) => url.startsWith('/token?') && url.includes('permissions='))).toBe(
        true,
      );
      expect(urls.some((url) => url.startsWith('/token?') && url.includes('repository=repo'))).toBe(
        true,
      );
    },
  );

  test('scoped mint answered with an unverifiable response -> token endpoint errors', async () => {
    const mintDir = makeTestTempDir('m3b-mint-');
    disposables.push(() => rmSync(mintDir, { recursive: true, force: true }));
    const socketPath = join(mintDir, 'mint.sock');
    const mint = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
      res.end(
        JSON.stringify(
          params.has('repository')
            ? {
                token: 'scope-ignoring-mint',
                expiresAt: new Date(Date.now() + 3600_000).toISOString(),
                installationId: 7,
                appSlug: 'cairnwright',
              }
            : {
                token: 'membership-listing',
                expiresAt: new Date(Date.now() + 3600_000).toISOString(),
                installationId: 7,
                appSlug: 'cairnwright',
                permissions: { metadata: 'read' },
              },
        ),
      );
    });
    await new Promise<void>((resolve) => mint.listen(socketPath, resolve));
    disposables.push(() => {
      mint.close();
    });
    const w = await setupGitWorld({
      githubAppTokenSocket: socketPath,
      githubFetch: async () => Response.json({ id: 4242, full_name: 'owner/repo' }),
    });
    w.s.db
      .update(projectTable)
      .set({ repoKind: 'github', githubRepo: 'owner/repo' })
      .where(eq(projectTable.id, w.projectId))
      .run();
    upsertGithubConnection(
      { db: w.s.db, box: w.s.secretBox },
      {
        teamId: w.s.team.id,
        login: 'human',
        githubUserId: 12,
        githubName: 'Human',
        accessToken: 'identity-test-user',
        scope: 'repo',
      },
    );
    w.startBuild();
    const claimed = await w.claim();
    const response = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
      {
        cred: w.token,
      },
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body.includes('identity-test-user')).toBe(false);
    expect(body.includes('scope-ignoring-mint')).toBe(false);
  });

  test('token requests mint for the repository captured on the claim, not a later retarget', async () => {
    const mintDir = makeTestTempDir('m3b-mint-');
    disposables.push(() => rmSync(mintDir, { recursive: true, force: true }));
    const socketPath = join(mintDir, 'mint.sock');
    const urls: string[] = [];
    const mint = createServer((req, res) => {
      urls.push(req.url ?? '');
      res.setHeader('content-type', 'application/json');
      const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
      const repository = params.get('repository');
      const repositoryId = params.get('repository_id');
      res.end(
        JSON.stringify({
          token: `scoped-${repository ?? 'all'}`,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          installationId: 7,
          appSlug: 'cairnwright',
          permissions: Object.fromEntries(
            (params.get('permissions') ?? '')
              .split(',')
              .filter((entry) => entry.includes(':'))
              .map((entry) => entry.split(':') as [string, string]),
          ),
          ...(repository === null ? {} : { repositories: [`owner/${repository}`] }),
          ...(repositoryId === null ? {} : { repositoryId: Number(repositoryId) }),
        }),
      );
    });
    await new Promise<void>((resolve) => mint.listen(socketPath, resolve));
    disposables.push(() => {
      mint.close();
    });
    let repoAId = 4242;
    const w = await setupGitWorld({
      githubAppTokenSocket: socketPath,
      githubFetch: async (input) =>
        String(input).endsWith('/repos/owner/repo-a')
          ? Response.json({ id: repoAId, full_name: 'owner/repo-a' })
          : Response.json({
              total_count: 2,
              repositories: [{ full_name: 'owner/repo-a' }, { full_name: 'owner/repo-b' }],
            }),
    });
    w.s.db
      .update(projectTable)
      .set({ repoKind: 'github', githubRepo: 'owner/repo-a' })
      .where(eq(projectTable.id, w.projectId))
      .run();
    w.startBuild();
    const claimed = await w.claim();
    const pin = w.s.db.select().from(stepTable).where(eq(stepTable.id, claimed.step.id)).get();
    expect(pin?.claimedRepo).toBe('owner/repo-a');
    expect(pin?.claimedRepoId).toBe(4242);
    expect(claimed.project?.repo?.cloneUrl).toBe('https://github.com/owner/repo-a.git');
    w.s.db
      .update(projectTable)
      .set({ githubRepo: 'owner/repo-b' })
      .where(eq(projectTable.id, w.projectId))
      .run();
    repoAId = 9999;
    const response = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
      {
        cred: w.token,
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const result = machineTokenResponseSchema.parse(await response.json());
    expect(result.git?.kind).toBe('app');
    expect(result.git?.password).toBe('scoped-repo-a');
    expect(urls.some((url) => url.startsWith('/token?') && url.includes('repository=repo-a'))).toBe(
      true,
    );
    expect(urls.some((url) => url.includes('repository=repo-b'))).toBe(false);
    expect(urls.some((url) => url.includes('repository_id=4242'))).toBe(true);
    expect(urls.some((url) => url.includes('repository_id=9999'))).toBe(false);
  });

  test.each([
    [
      'timeout',
      () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
      'lookup failed',
    ],
    ['rate limit', () => new Response(null, { status: 429 }), 'rate limited'],
    ['upstream outage', () => new Response(null, { status: 503 }), 'lookup failed'],
  ] as const)(
    'a repository probe %s fails the step visibly on the first poll',
    async (_, reply, reason) => {
      const githubFetch = vi.fn(async () => reply());
      const w = await setupGitWorld({ githubFetch });
      w.s.db
        .update(projectTable)
        .set({ repoKind: 'github', githubRepo: 'owner/repo' })
        .where(eq(projectTable.id, w.projectId))
        .run();
      upsertGithubConnection(
        { db: w.s.db, box: w.s.secretBox },
        {
          teamId: w.s.team.id,
          login: 'human',
          githubUserId: 12,
          githubName: 'Human',
          accessToken: 'identity-test-user',
          scope: 'repo',
        },
      );
      const buildId = w.startBuild();
      const claim = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
        cred: w.token,
        body: {},
      });
      expect(claim.status).toBe(200);
      expect(await claim.json()).toMatchObject({ step: null });
      const failed = w.s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get();
      expect(failed).toMatchObject({ status: 'failed', claimedRepoId: null });
      const build = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
      expect(build?.errorMessage).toContain(reason);
      expect(githubFetch).toHaveBeenCalledTimes(1);
    },
  );

  test('a missing read credential returns 503 and exposes the App failure on the step', async () => {
    const githubFetch = vi.fn(async () => Response.json({ id: 4242, full_name: 'owner/repo' }));
    const w = await setupGitWorld({ githubFetch });
    w.s.db
      .update(projectTable)
      .set({ repoKind: 'github', githubRepo: 'owner/repo' })
      .where(eq(projectTable.id, w.projectId))
      .run();
    const buildId = w.startBuild();
    stubGithubApp('repo-not-installed');
    try {
      const claim = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
        cred: w.token,
        body: {},
      });
      expect(claim.status).toBe(503);
      expect(await claim.json()).toMatchObject({ reason: 'repo-not-installed' });
      const failed = w.s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get();
      expect(failed).toMatchObject({ status: 'failed', claimedRepoId: null });
      const build = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
      expect(build?.errorMessage).toContain('repo-not-installed');
      expect(githubFetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  test.each([404, 200])(
    'a github claim with an unresolved repository id (%s) fails closed at token time',
    async (status) => {
      const mintDir = makeTestTempDir('m3b-mint-');
      disposables.push(() => rmSync(mintDir, { recursive: true, force: true }));
      const socketPath = join(mintDir, 'mint.sock');
      const urls: string[] = [];
      const mint = createServer((req, res) => {
        urls.push(req.url ?? '');
        res.setHeader('content-type', 'application/json');
        const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const repository = params.get('repository');
        res.end(
          JSON.stringify({
            token: `scoped-${repository ?? 'all'}`,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            installationId: 7,
            appSlug: 'cairnwright',
            permissions: Object.fromEntries(
              (params.get('permissions') ?? '')
                .split(',')
                .filter((entry) => entry.includes(':'))
                .map((entry) => entry.split(':') as [string, string]),
            ),
            ...(repository === null ? {} : { repositories: [`owner/${repository}`] }),
          }),
        );
      });
      await new Promise<void>((resolve) => mint.listen(socketPath, resolve));
      disposables.push(() => {
        mint.close();
      });
      const w = await setupGitWorld({
        githubAppTokenSocket: socketPath,
        githubFetch: async () =>
          status === 404
            ? new Response(null, { status })
            : Response.json({ id: Number.MAX_SAFE_INTEGER + 1, full_name: 'owner/repo' }),
      });
      w.s.db
        .update(projectTable)
        .set({ repoKind: 'github', githubRepo: 'owner/repo' })
        .where(eq(projectTable.id, w.projectId))
        .run();
      w.startBuild();
      const claimed = await w.claim();
      expect(
        w.s.db.select().from(stepTable).where(eq(stepTable.id, claimed.step.id)).get()
          ?.claimedRepoId ?? null,
      ).toBeNull();
      const response = await call(
        w.s.app,
        'GET',
        `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
        {
          cred: w.token,
        },
      );
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body.includes('claim-pin-unresolved')).toBe(true);
      expect(urls.some((url) => url.includes('contents:write'))).toBe(false);
    },
  );

  test('a claim reassigned while the mint is in flight receives no token', async () => {
    const mintDir = makeTestTempDir('m3b-mint-');
    disposables.push(() => rmSync(mintDir, { recursive: true, force: true }));
    const socketPath = join(mintDir, 'mint.sock');
    const urls: string[] = [];
    let mintStarted!: () => void;
    let releaseMint!: () => void;
    const mintInFlight = new Promise<void>((resolve) => {
      mintStarted = resolve;
    });
    const mintGate = new Promise<void>((resolve) => {
      releaseMint = resolve;
    });
    const mint = createServer((req, res) => {
      urls.push(req.url ?? '');
      res.setHeader('content-type', 'application/json');
      const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
      const repository = params.get('repository');
      const repositoryId = params.get('repository_id');
      const send = () =>
        res.end(
          JSON.stringify({
            token: `scoped-${repository ?? 'all'}`,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            installationId: 7,
            appSlug: 'cairnwright',
            permissions: Object.fromEntries(
              (params.get('permissions') ?? '')
                .split(',')
                .filter((entry) => entry.includes(':'))
                .map((entry) => entry.split(':') as [string, string]),
            ),
            ...(repository === null ? {} : { repositories: [`owner/${repository}`] }),
            ...(repositoryId === null ? {} : { repositoryId: Number(repositoryId) }),
          }),
        );
      if (repository === null || !(params.get('permissions') ?? '').includes('contents:write')) {
        send();
        return;
      }
      mintStarted();
      void mintGate.then(send);
    });
    await new Promise<void>((resolve) => mint.listen(socketPath, resolve));
    disposables.push(() => {
      mint.close();
    });
    const w = await setupGitWorld({
      githubAppTokenSocket: socketPath,
      githubFetch: async () => Response.json({ id: 4242, full_name: 'owner/repo' }),
    });
    w.s.db
      .update(projectTable)
      .set({ repoKind: 'github', githubRepo: 'owner/repo' })
      .where(eq(projectTable.id, w.projectId))
      .run();
    w.startBuild();
    const claimed = await w.claim();
    const pending = call(
      w.s.app,
      'GET',
      `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
      { cred: w.token },
    );
    await mintInFlight;
    w.s.db
      .update(stepTable)
      .set({ machineId: 'other-machine' })
      .where(eq(stepTable.id, claimed.step.id))
      .run();
    releaseMint();
    const response = await pending;
    expect(response.status).toBe(409);
    const body = await response.text();
    expect(body.includes('scoped-repo')).toBe(false);
    expect(urls.some((url) => url.startsWith('/token?') && url.includes('repository=repo'))).toBe(
      true,
    );
  });

  test.each([null, 'owner/repo/../../escape', 'garbage'])(
    'a github claim whose pin is %s gets no credential -> 503, the step stays claimed',
    async (pin) => {
      const mintDir = makeTestTempDir('m3b-mint-');
      disposables.push(() => rmSync(mintDir, { recursive: true, force: true }));
      const socketPath = join(mintDir, 'mint.sock');
      const urls: string[] = [];
      const mint = createServer((req, res) => {
        urls.push(req.url ?? '');
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            token: 'minted-for-live-binding',
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            installationId: 7,
            appSlug: 'cairnwright',
          }),
        );
      });
      await new Promise<void>((resolve) => mint.listen(socketPath, resolve));
      disposables.push(() => {
        mint.close();
      });
      const w = await setupGitWorld({
        githubAppTokenSocket: socketPath,
        githubFetch: async () => Response.json({ id: 4242, full_name: 'owner/repo' }),
      });
      w.s.db
        .update(projectTable)
        .set({ repoKind: 'github', githubRepo: 'owner/repo' })
        .where(eq(projectTable.id, w.projectId))
        .run();
      upsertGithubConnection(
        { db: w.s.db, box: w.s.secretBox },
        {
          teamId: w.s.team.id,
          login: 'human',
          githubUserId: 12,
          githubName: 'Human',
          accessToken: 'identity-test-user',
          scope: 'repo',
        },
      );
      w.startBuild();
      const claimed = await w.claim();
      urls.length = 0;
      w.s.db
        .update(stepTable)
        .set({ claimedRepo: pin })
        .where(eq(stepTable.id, claimed.step.id))
        .run();
      const response = await call(
        w.s.app,
        'GET',
        `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
        {
          cred: w.token,
        },
      );
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body.includes('identity-test-user')).toBe(false);
      expect(body.includes('minted-for-live-binding')).toBe(false);
      expect(urls).toEqual([]);
      expect(
        w.s.db
          .select({ status: stepTable.status })
          .from(stepTable)
          .where(eq(stepTable.id, claimed.step.id))
          .get()?.status,
      ).toBe('claimed');
    },
  );
});

describe('credential bundle final claim fence', () => {
  const bareBody = async (response: Response) => {
    const body = (await response.json()) as Record<string, unknown>;
    for (const field of ['git', 'provider', 'secrets', 'httpSecrets', 'mcpConnectors'])
      expect(body).not.toHaveProperty(field);
    return body;
  };

  test('a completed step receives no credentials', async () => {
    const w = await setupGitWorld();
    w.startBuild();
    const claimed = await w.claim();
    await w.done(claimed.step.id, { status: 'success', sessionId: 'pi-1' });
    const response = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
      { cred: w.token },
    );
    expect(response.status).toBe(409);
    await bareBody(response);
  });

  test('a request without the claim generation is refused', async () => {
    const w = await setupGitWorld();
    w.startBuild();
    const claimed = await w.claim();
    const response = await call(w.s.app, 'GET', `/api/machine/token/${claimed.step.id}`, {
      cred: w.token,
    });
    expect(response.status).toBe(409);
    await bareBody(response);
  });

  test.each(['abc', '-1', `${Date.now()}`])(
    'a request with generation %s that is not the live claim is refused',
    async (generation) => {
      const w = await setupGitWorld();
      w.startBuild();
      const claimed = await w.claim();
      expect(`${claimed.step.generation}`).not.toBe(generation);
      const response = await call(
        w.s.app,
        'GET',
        `/api/machine/token/${claimed.step.id}?generation=${generation}`,
        { cred: w.token },
      );
      expect(response.status).toBe(409);
      await bareBody(response);
    },
  );

  test('a step reclaimed on the same machine refuses the stale generation and answers the live one', async () => {
    const w = await setupGitWorld();
    w.startBuild();
    const claimed = await w.claim();
    const live = (claimed.step.generation ?? 0) + 1;
    w.s.db
      .update(stepTable)
      .set({ claimedAt: live })
      .where(eq(stepTable.id, claimed.step.id))
      .run();
    const stale = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
      { cred: w.token },
    );
    expect(stale.status).toBe(409);
    await bareBody(stale);
    const fresh = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${claimed.step.id}?generation=${live}`,
      { cred: w.token },
    );
    expect(fresh.status).toBe(200);
    const token = machineTokenResponseSchema.parse(await fresh.json());
    expect(token.git?.password).toMatch(/^cairn_[0-9a-f]{48}$/);
  });
});
