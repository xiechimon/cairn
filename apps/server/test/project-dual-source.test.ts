import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { agent as agentTable, project as projectTable } from '../src/db/schema.js';
import { bindAllAgents, bootServer, issueApiKey, req, type TestServer } from './helpers.js';

const s = bootServer({ claimHoldMs: 200 });
afterAll(() => s.dispose());

interface ProjectReply {
  id?: string;
  repoKind?: string;
  githubRepo?: string;
  localPath?: string | null;
  error?: string;
  reason?: string;
}

async function postCreate(body: unknown): Promise<{ status: number; body: ProjectReply }> {
  const res = await req(s.app, 'POST', '/api/projects', body);
  return { status: res.status, body: (await res.json()) as ProjectReply };
}

async function patchProject(
  id: string,
  body: unknown,
): Promise<{ status: number; body: ProjectReply }> {
  const res = await req(s.app, 'PATCH', `/api/projects/${id}`, body);
  return { status: res.status, body: (await res.json()) as ProjectReply };
}

async function createGithubProject(name: string): Promise<string> {
  const r = await postCreate({ name, kind: 'github', githubRepo: 'octo/dual' });
  expect(r.status).toBe(201);
  return String(r.body.id);
}

describe('POST /api/projects kind=github + localPath -- shape validation (#1213)', () => {
  test('T1 an absolute path (nonexistent) -> 201 stored: the server does not verify existence (the path lives on the execution machine)', async () => {
    const missing = '/definitely/not/here/cairn';
    const r = await postCreate({
      name: 'p-dual-t1',
      kind: 'github',
      githubRepo: 'octo/dual',
      localPath: missing,
    });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('github');
    expect(r.body.localPath).toBe(missing);
    const row = s.db
      .select()
      .from(projectTable)
      .where(eq(projectTable.id, String(r.body.id)))
      .get();
    expect(row?.repoKind).toBe('github');
    expect(row?.localPath).toBe(missing);
  });

  test('T2 a relative path -> 400 + reason not_absolute', async () => {
    const r = await postCreate({
      name: 'p-dual-t2',
      kind: 'github',
      githubRepo: 'octo/dual',
      localPath: 'relative/dir',
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('absolute');
    expect(r.body.reason).toBe('not_absolute');
  });

  test('T3 local + githubRepo -> 400 (the local shape has no githubRepo slot, semantics unchanged)', async () => {
    const r = await postCreate({
      name: 'p-dual-t3',
      kind: 'local',
      localPath: '/tmp/any-git-repo-would-do-but-shape-only-here',
      githubRepo: 'octo/dual',
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('githubRepo');
  });

  test('T4 localPath null / empty string -> 201 without storing (empty means unset)', async () => {
    for (const localPath of [null, '', '   ']) {
      const r = await postCreate({
        name: `p-dual-t4-${JSON.stringify(localPath).replace(/\W/g, '')}`,
        kind: 'github',
        githubRepo: 'octo/dual',
        localPath,
      });
      expect(r.status).toBe(201);
      expect(r.body.localPath).toBeUndefined();
    }
  });
});

describe('PATCH /api/projects/{id} -- the localPath accelerator write surface (#1213)', () => {
  test('P1 a github project gains localPath -> 200 + the value in record/DB', async () => {
    const id = await createGithubProject('p-dual-p1');
    const path = '/Users/who/code/cairn';
    const r = await patchProject(id, { localPath: path });
    expect(r.status).toBe(200);
    expect(r.body.repoKind).toBe('github');
    expect(r.body.localPath).toBe(path);
    const row = s.db.select().from(projectTable).where(eq(projectTable.id, id)).get();
    expect(row?.localPath).toBe(path);
  });

  test('P2 clearing with an explicit null -> 200 + DB column null + the record key absent', async () => {
    const id = await createGithubProject('p-dual-p2');
    await patchProject(id, { localPath: '/Users/who/code/cairn' });
    const r = await patchProject(id, { localPath: null });
    expect(r.status).toBe(200);
    expect(r.body.localPath).toBeUndefined();
    const row = s.db.select().from(projectTable).where(eq(projectTable.id, id)).get();
    expect(row?.localPath).toBeNull();
  });

  test('P3 the localPath key on a local-shape project -> 400 (the accelerator belongs to the github shape only)', async () => {
    const id = 'proj-dual-local-row';
    s.db
      .insert(projectTable)
      .values({
        id,
        name: 'p-dual-local',
        teamId: s.team.id,
        repoKind: 'local',
        repoName: null,
        githubRepo: null,
        localPath: '/tmp/some-user-repo',
      })
      .run();
    const r = await patchProject(id, { localPath: '/any/absolute/path' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('github');
    const r2 = await patchProject(id, { localPath: null });
    expect(r2.status).toBe(400);
  });

  test('P4 unknown project -> 404', async () => {
    const r = await patchProject('proj-no-such', { localPath: '/abs' });
    expect(r.status).toBe(404);
  });

  test('P5 all five keys missing (empty body) -> 400 (#1242 overturns the #1213 200 no-op pin: an early exit on missing keys kills the silent family; the explicit null clear and the unset state stay distinct)', async () => {
    const id = await createGithubProject('p-dual-p5');
    await patchProject(id, { localPath: '/Users/who/code/cairn' });
    const r = await patchProject(id, {});
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('body');
    const row = s.db.select().from(projectTable).where(eq(projectTable.id, id)).get();
    expect(row?.localPath).toBe('/Users/who/code/cairn');
  });

  test('P6 a relative path -> 400 + reason not_absolute', async () => {
    const id = await createGithubProject('p-dual-p6');
    const r = await patchProject(id, { localPath: 'rel/x' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('absolute');
    expect(r.body.reason).toBe('not_absolute');
  });

  test('P7 the localPath key on a hosted-shape project -> 400', async () => {
    const r = await postCreate({ name: 'p-dual-hosted', kind: 'hosted' });
    expect(r.status).toBe(201);
    const pr = await patchProject(String(r.body.id), { localPath: '/abs' });
    expect(pr.status).toBe(400);
    expect(String(pr.body.error)).toContain('github');
  });

  test('P8 an empty string -> cleared (empty means null)', async () => {
    const id = await createGithubProject('p-dual-p8');
    await patchProject(id, { localPath: '/Users/who/code/cairn' });
    const r = await patchProject(id, { localPath: '   ' });
    expect(r.status).toBe(200);
    const row = s.db.select().from(projectTable).where(eq(projectTable.id, id)).get();
    expect(row?.localPath).toBeNull();
  });
});

const AGENT_ID = 'agent-dual-1';

const claimDisposables: (() => void)[] = [];
afterAll(() => {
  for (const d of claimDisposables) d();
});

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

async function claimGithubProject(s2: TestServer, localPath: string | null): Promise<ClaimedStep> {
  const key = await issueApiKey(s2);
  const enrollRes = await call(s2.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s2.team.id, name: 'dual-src-mbp', cliVersion: '0.1.0' },
  });
  const machineToken = ((await enrollRes.json()) as { token: string }).token;
  s2.db
    .insert(agentTable)
    .values({ id: AGENT_ID, teamId: s2.team.id, displayName: 'dual-builder', modelId: 'm' })
    .run();
  bindAllAgents(s2);
  const projBody: Record<string, unknown> = {
    name: 'dual-claim',
    kind: 'github',
    githubRepo: 'octo/dual-claim',
  };
  if (localPath !== null) projBody.localPath = localPath;
  const projRes = await call(s2.app, 'POST', '/api/projects', { body: projBody });
  expect(projRes.status).toBe(201);
  const project = (await projRes.json()) as { id: string };
  const todoRes = await call(s2.app, 'POST', `/api/projects/${project.id}/todos`, {
    body: { title: '双源探针', spec: '改一行' },
  });
  const todo = (await todoRes.json()) as { id: string };
  const buildRes = await call(s2.app, 'POST', `/api/projects/${project.id}/builds`, {
    body: {
      todoIds: [todo.id],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: false,
    },
  });
  expect(buildRes.status).toBe(201);
  const claimRes = await call(s2.app, 'POST', '/api/machine/tasks/claim', {
    cred: machineToken,
    body: {},
  });
  const body = (await claimRes.json()) as { step: ClaimedStep | null };
  if (!body.step) throw new Error('claim returned no step');
  return claimedStepSchema.parse(body.step);
}

describe('claim payload project.repo.localPath (#1213)', () => {
  test('C1 a github project with localPath -> repo carries localPath', async () => {
    const s2 = bootServer({ claimHoldMs: 200 });
    claimDisposables.push(() => s2.dispose());
    const claimed = await claimGithubProject(s2, '/Users/who/code/cairn');
    expect(claimed.project?.repo).toEqual({
      kind: 'github',
      cloneUrl: 'https://github.com/octo/dual-claim.git',
      localPath: '/Users/who/code/cairn',
    });
  });

  test('C2 a github project without localPath -> repo has no localPath key (zero drift of the existing shape)', async () => {
    const s2 = bootServer({ claimHoldMs: 200 });
    claimDisposables.push(() => s2.dispose());
    const claimed = await claimGithubProject(s2, null);
    expect(claimed.project?.repo).toEqual({
      kind: 'github',
      cloneUrl: 'https://github.com/octo/dual-claim.git',
    });
  });
});
