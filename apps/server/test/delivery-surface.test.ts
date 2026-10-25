import type { ClaimedStep } from '@cairn/shared';
import { CHANGES_DIFF_MAX_BYTES, claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { agent as agentTable, build as buildTable, todo as todoTable } from '../src/db/schema.js';
import { bindAllAgents, bootServer, issueApiKey, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-704-1';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

interface World {
  s: TestServer;
  token: string;
  githubProjectId: string;
  plainProjectId: string;
  startBuild(projectId: string): Promise<string>;
  claim(): Promise<ClaimedStep>;
  done(stepId: string, body: Record<string, unknown>): Promise<Response>;
}

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 200 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'm704', cliVersion: '0.1.0' },
  });
  const machineJson = (await enrollRes.json()) as { token: string };
  s.db
    .insert(agentTable)
    .values({ id: AGENT_ID, teamId: s.team.id, displayName: 'b704', modelId: 'm' })
    .run();
  bindAllAgents(s);

  const ghRes = await call(s.app, 'POST', '/api/projects', {
    body: { name: 'probe-704', kind: 'github', githubRepo: 'octocat/Hello-World' },
  });
  expect(ghRes.status).toBe(201);
  const ghProject = (await ghRes.json()) as { id: string };
  const plainRes = await call(s.app, 'POST', '/api/projects', { body: { name: 'plain-704' } });
  const plainProject = (await plainRes.json()) as { id: string };
  const todoRes = await call(s.app, 'POST', `/api/projects/${ghProject.id}/todos`, {
    body: { title: '704 探针', spec: '改一行' },
  });
  const todoBody = (await todoRes.json()) as { id: string };
  const plainTodoRes = await call(s.app, 'POST', `/api/projects/${plainProject.id}/todos`, {
    body: { title: 'plain', spec: 's' },
  });
  const plainTodo = (await plainTodoRes.json()) as { id: string };
  return {
    s,
    token: machineJson.token,
    githubProjectId: ghProject.id,
    plainProjectId: plainProject.id,
    async startBuild(projectId) {
      const todoId = projectId === ghProject.id ? todoBody.id : plainTodo.id;
      const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: {
          todoIds: [todoId],
          assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
          withPlan: false,
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
  };
}

const SAMPLE_DIFF = [
  'diff --git a/README.md b/README.md',
  'index 1111111..2222222 100644',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1,2 @@',
  ' hello',
  '+probe 704',
  '',
].join('\n');

describe('done channel delivery-surface backfill (#704 / B-C16)', () => {
  test('failure mode 1: done carries prUrl/prNumber -> build row backfilled', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild(w.githubProjectId);
    const claimed = await w.claim();
    const res = await w.done(claimed.step.id, {
      status: 'success',
      prUrl: 'https://github.com/octocat/Hello-World/pull/606',
      prNumber: 606,
    });
    expect(res.status).toBe(200);
    const row = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
    expect(row?.prUrl).toBe('https://github.com/octocat/Hello-World/pull/606');
    expect(row?.prNumber).toBe(606);
  });

  test('failure mode 2: done without PR fields -> row stays null (no fabricated empty data)', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild(w.githubProjectId);
    const claimed = await w.claim();
    await w.done(claimed.step.id, { status: 'success' });
    const row = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
    expect(row?.prUrl).toBeNull();
    expect(row?.prNumber).toBeNull();
  });

  test('failure mode 3: done carries changesDiff -> changes endpoint returns the real diff file set', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild(w.githubProjectId);
    const claimed = await w.claim();
    await w.done(claimed.step.id, { status: 'success', changesDiff: SAMPLE_DIFF });
    const res = await call(w.s.app, 'GET', `/api/builds/${buildId}/changes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      files: { path: string; additions: number; deletions: number }[];
      reported: boolean;
      changed: boolean;
    };
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toMatchObject({ path: 'README.md', additions: 1, deletions: 0 });
    expect(body.reported).toBe(true);
    expect(body.changed).toBe(true);
  });

  test('failure mode 7: changesDiff empty string -> files empty and reported (empty commit)', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild(w.githubProjectId);
    const claimed = await w.claim();
    await w.done(claimed.step.id, { status: 'success', changesDiff: '' });
    const res = await call(w.s.app, 'GET', `/api/builds/${buildId}/changes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: unknown[]; reported: boolean; changed: boolean };
    expect(body.files).toEqual([]);
    expect(body.reported).toBe(true);
    expect(body.changed).toBe(false);
  });

  test('failure mode 8: 100% rename with no hunk -> files empty and changed', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild(w.githubProjectId);
    const claimed = await w.claim();
    const rename = [
      'diff --git a/old-name.txt b/new-name.txt',
      'similarity index 100%',
      'rename from old-name.txt',
      'rename to new-name.txt',
      '',
    ].join('\n');
    await w.done(claimed.step.id, { status: 'success', changesDiff: rename });
    const res = await call(w.s.app, 'GET', `/api/builds/${buildId}/changes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: unknown[]; reported: boolean; changed: boolean };
    expect(body.files).toEqual([]);
    expect(body.reported).toBe(true);
    expect(body.changed).toBe(true);
  });

  test('failure mode 4: changesDiff over the cap -> dropped (done still 200, row not half-written)', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild(w.githubProjectId);
    const claimed = await w.claim();
    const oversized = `${'x'.repeat(CHANGES_DIFF_MAX_BYTES + 1)}`;
    const res = await w.done(claimed.step.id, {
      status: 'success',
      changesDiff: oversized,
    });
    expect(res.status).toBe(200);
    const row = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
    expect(row?.changes).toBeNull();
  });

  test('failure mode 6: build not reported / repo-less project -> {files:[]} (null != empty array)', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild(w.githubProjectId);
    const claimed = await w.claim();
    await w.done(claimed.step.id, { status: 'success' });
    const res = await call(w.s.app, 'GET', `/api/builds/${buildId}/changes`);
    const body = (await res.json()) as { files: unknown[]; reported: boolean };
    expect(body.files).toEqual([]);
    expect(body.reported).toBe(false);
    const plainBuildId = await w.startBuild(w.plainProjectId);
    const plainClaimed = await w.claim();
    await w.done(plainClaimed.step.id, { status: 'success' });
    const plainRes = await call(w.s.app, 'GET', `/api/builds/${plainBuildId}/changes`);
    const plainBody = (await plainRes.json()) as { files: unknown[]; reported: boolean };
    expect(plainBody.files).toEqual([]);
    expect(plainBody.reported).toBe(false);
  });
});

describe('hosted form source-of-truth does not drift (#704: the bare repo is still the only truth)', () => {
  test('failure mode 5: a hosted build reporting changesDiff does not change the projection source (bare repo read surface)', async () => {
    const w = await setupWorld();
    const projRes = await call(w.s.app, 'POST', '/api/projects', {
      body: { name: 'hosted-704', repoKind: 'hosted' },
    });
    const project = (await projRes.json()) as { id: string };
    const todoRes = await call(w.s.app, 'POST', `/api/projects/${project.id}/todos`, {
      body: { title: 'hosted 探针', spec: 's' },
    });
    const todoRow = (await todoRes.json()) as { id: string };
    await call(w.s.app, 'POST', `/api/projects/${project.id}/builds`, {
      body: {
        todoIds: [todoRow.id],
        assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
        withPlan: false,
      },
    });
    const claimed = await w.claim();
    await w.done(claimed.step.id, { status: 'success', changesDiff: SAMPLE_DIFF });
    const buildRow = w.s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, claimed.step.buildId))
      .get();
    const todoDb = w.s.db.select().from(todoTable).where(eq(todoTable.id, buildRow!.todoId)).get();
    expect(todoDb?.projectId).toBe(project.id);
    const res = await call(w.s.app, 'GET', `/api/builds/${claimed.step.buildId}/changes`);
    const body = (await res.json()) as { files: unknown[]; reported: boolean };
    expect(body.files).toEqual([]);
    expect(body.reported).toBe(false);
  });
});
