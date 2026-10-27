import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ClaimedStep, todoRecordSchema } from '@cairn/shared';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import {
  deleteGithubConnection,
  upsertGithubConnection,
} from '../src/services/github-connection.js';
import { flushSelfIssueWrites } from '../src/services/todos.js';
import { bindAllAgents, bootServer, issueApiKey, postProject, type TestServer } from './helpers.js';

let throttleHome: string;
beforeAll(async () => {
  throttleHome = await mkdtemp(join(tmpdir(), 'github-writeback-'));
  vi.stubEnv('CAIRN_HOME', throttleHome);
  vi.stubEnv('CAIRN_GITHUB_CREATE_MIN_INTERVAL_MS', '0');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(throttleHome, { recursive: true, force: true });
});

const TOKEN = 'ghp_writeback_token';
const REPO = 'octo/alpha';
const ISSUES_PATH = `/repos/${REPO}/issues`;
const issuePath = (n: number) => `/repos/${REPO}/issues/${n}`;

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

export interface GhCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

interface GhResponse {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

function ghMock(initial: Record<string, GhResponse> = {}) {
  const routes = new Map<string, GhResponse>(Object.entries(initial));
  const calls: GhCall[] = [];
  const impl: FetchLike = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, headers: { ...(init?.headers ?? {}) }, body: init?.body });
    const route = routes.get(`${method} ${new URL(url).pathname}`);
    const res = route ?? { status: 404, body: { message: `no mock for ${method} ${url}` } };
    const status = res.status ?? 200;
    const headers = res.headers ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      json: async () => res.body,
      text: async () => JSON.stringify(res.body),
    };
  };
  return {
    impl,
    calls,
    set(key: string, res: GhResponse): void {
      routes.set(key, res);
    },
    callsTo(method: string, path: string): GhCall[] {
      return calls.filter((c) => c.method === method && new URL(c.url).pathname === path);
    },
  };
}

type GhMock = ReturnType<typeof ghMock>;

const CREATED_ISSUE = { number: 101, title: 'x', state: 'open', labels: [] };

function seedConnection(s: TestServer): void {
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'octo', accessToken: TOKEN, scope: 'repo' },
  );
}

async function postGithubProject(app: Hono, name = 'alpha'): Promise<string> {
  const res = await call(app, 'POST', '/api/projects', {
    body: { name, kind: 'github', githubRepo: REPO },
  });
  if (res.status !== 201) throw new Error(`postGithubProject: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

async function createTask(
  app: Hono,
  projectId: string,
  spec = '给登录页加图形验证码',
): Promise<{
  id: string;
  status: number;
  record: ReturnType<typeof todoRecordSchema.parse> | null;
  elapsedMs: number;
}> {
  const t0 = Date.now();
  const res = await call(app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '', spec },
  });
  const elapsedMs = Date.now() - t0;
  const status = res.status;
  const record = status === 201 ? todoRecordSchema.parse(await res.json()) : null;
  return { id: record?.id ?? '', status, record, elapsedMs };
}

async function getTodo(app: Hono, id: string) {
  return todoRecordSchema.parse(await (await call(app, 'GET', `/api/todos/${id}`)).json());
}

describe('self-created issues: stored as not-yet-created, source backfilled after async creation (A family)', () => {
  test('W1 creating a task on a connected github project: 201 returns immediately (not-yet-created state) -> async creation backfills sourceRef + v++ + doc event; POST body = title + body, token only in headers', async () => {
    const mock = ghMock({ [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE } });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const publishSpy = vi.spyOn(s.hub, 'publishTodoDoc');
    const spec = '给登录页加图形验证码\n\n要求：错误 5 次后触发。';
    const created = await createTask(s.app, projectId, spec);
    expect(created.status).toBe(201);
    expect(created.record?.sourceKind).toBe('github-issue-self');
    expect(created.record?.sourceRef).toBeNull();
    await flushSelfIssueWrites();
    const after = await getTodo(s.app, created.id);
    expect(after.sourceRef).toBe(`github:${REPO}#101`);
    expect(after.v).toBe((created.record?.v ?? 0) + 1);
    const published = publishSpy.mock.calls.map(([, rec]) => rec);
    expect(published.some((r) => r.sourceRef === `github:${REPO}#101`)).toBe(true);
    const posts = mock.callsTo('POST', ISSUES_PATH);
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]!.body!)).toEqual({ title: '给登录页加图形验证码', body: spec });
    expect(posts[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(posts[0]!.url).not.toContain(TOKEN);
    s.dispose();
  });

  test('W2/A6 critical-path constraint: with outbound GitHub hanging, the create-task request still returns immediately, zero GitHub awaits', async () => {
    let release:
      | ((res: {
          ok: boolean;
          status: number;
          headers: { get(n: string): string | null };
          json(): Promise<unknown>;
          text(): Promise<string>;
        }) => void)
      | undefined;
    const hanging: FetchLike = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const s = bootServer({ githubFetch: hanging });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const created = await createTask(s.app, projectId);
    expect(created.status).toBe(201);
    expect(created.elapsedMs).toBeLessThan(2000);
    expect(created.record?.sourceKind).toBe('github-issue-self');
    expect(created.record?.sourceRef).toBeNull();
    await vi.waitFor(() => expect(release).toBeDefined());
    release?.({
      ok: true,
      status: 201,
      headers: { get: () => null },
      json: async () => CREATED_ISSUE,
      text: async () => JSON.stringify(CREATED_ISSUE),
    });
    await flushSelfIssueWrites();
    expect((await getTodo(s.app, created.id)).sourceRef).toBe(`github:${REPO}#101`);
    s.dispose();
  });

  test('W3/A2-A5 creation fails (permission 404 / permission 403 / network down / malformed response): the task is still created, stays not-yet-created, no unhandled rejection', async () => {
    const failures: Array<{ key: string; res: GhResponse | 'throw' }> = [
      { key: '404', res: { status: 404, body: { message: 'Not Found' } } },
      { key: '403', res: { status: 403, body: { message: 'Resource not accessible' } } },
      { key: 'network', res: 'throw' },
      { key: 'malformed', res: { status: 200, body: { id: 1 } } },
    ];
    for (const f of failures) {
      const mock =
        f.res === 'throw'
          ? {
              impl: (async () => {
                throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
              }) as unknown as FetchLike,
              calls: [] as GhCall[],
              set: () => {},
              callsTo: () => [] as GhCall[],
            }
          : ghMock({ [`POST ${ISSUES_PATH}`]: f.res });
      const s = bootServer({ githubFetch: mock.impl });
      seedConnection(s);
      const projectId = await postGithubProject(s.app);
      const created = await createTask(s.app, projectId);
      expect(created.status, f.key).toBe(201);
      await flushSelfIssueWrites();
      const after = await getTodo(s.app, created.id);
      expect(after.sourceKind, f.key).toBe('github-issue-self');
      expect(after.sourceRef, f.key).toBeNull();
      s.dispose();
    }
  });

  test('a secondary limit retries the pending task and backfills its source', async () => {
    const mock = ghMock({ [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE } });
    let attempts = 0;
    const s = bootServer({
      githubFetch: async (input, init) => {
        if (init?.method === 'POST' && attempts++ === 0) {
          return {
            ok: false,
            status: 403,
            headers: { get: (name) => (name === 'retry-after' ? '1' : null) },
            json: async () => ({ message: 'secondary rate limit' }),
            text: async () => 'secondary rate limit',
          };
        }
        return mock.impl(input, init);
      },
    });
    try {
      seedConnection(s);
      const projectId = await postGithubProject(s.app);
      const created = await createTask(s.app, projectId);
      expect(created.status).toBe(201);
      expect(created.record?.sourceRef).toBeNull();
      await flushSelfIssueWrites();
      expect((await getTodo(s.app, created.id)).sourceRef).toBe(`github:${REPO}#101`);
      expect(attempts).toBe(2);
    } finally {
      s.dispose();
    }
  });

  test('W4/A1 project without a github connection: no creation, zero outbound, both columns null (no failure state shown)', async () => {
    const mock = ghMock({});
    const s = bootServer({ githubFetch: mock.impl });
    const projectId = await postGithubProject(s.app);
    const created = await createTask(s.app, projectId);
    expect(created.status).toBe(201);
    expect(created.record?.sourceKind).toBeNull();
    expect(created.record?.sourceRef).toBeNull();
    await flushSelfIssueWrites();
    expect(mock.calls).toHaveLength(0);
    s.dispose();
  });

  test('W5/A8 local (hosted) project: zero outbound, both columns null (behavior unchanged byte for byte)', async () => {
    const mock = ghMock({});
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postProject(s.app);
    const created = await createTask(s.app, projectId);
    expect(created.status).toBe(201);
    expect(created.record?.sourceKind).toBeNull();
    expect(created.record?.sourceRef).toBeNull();
    await flushSelfIssueWrites();
    expect(mock.calls).toHaveLength(0);
    s.dispose();
  });

  test('W6/A13 a successful retry uses the current title: retry after agent/user renamed it -> issue title = new title, source backfilled', async () => {
    const mock = ghMock({ [`POST ${ISSUES_PATH}`]: { status: 404, body: { message: 'no' } } });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const created = await createTask(s.app, projectId);
    await flushSelfIssueWrites();
    expect((await getTodo(s.app, created.id)).sourceRef).toBeNull();
    const patched = await call(s.app, 'PATCH', `/api/todos/${created.id}`, {
      body: { title: '正式标题' },
    });
    expect(patched.status).toBe(200);
    mock.set(`POST ${ISSUES_PATH}`, { status: 201, body: CREATED_ISSUE });
    const retry = await call(s.app, 'POST', `/api/todos/${created.id}/github-issue/retry`);
    expect(retry.status).toBe(200);
    const record = todoRecordSchema.parse(await retry.json());
    expect(record.sourceRef).toBe(`github:${REPO}#101`);
    const posts = mock.callsTo('POST', ISSUES_PATH);
    expect(JSON.parse(posts[posts.length - 1]!.body!).title).toBe('正式标题');
    s.dispose();
  });

  test('W7/A10 retry race: retry while the fire-and-forget is in flight -> 409, no double creation; source settles after it completes', async () => {
    let release: ((v: unknown) => void) | undefined;
    const hanging: FetchLike = () =>
      new Promise((resolve) => {
        release = resolve;
      }) as never;
    const s = bootServer({ githubFetch: hanging });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const created = await createTask(s.app, projectId);
    const retry = await call(s.app, 'POST', `/api/todos/${created.id}/github-issue/retry`);
    expect(retry.status).toBe(409);
    await vi.waitFor(() => expect(release).toBeDefined());
    release?.({
      ok: true,
      status: 201,
      headers: { get: () => null },
      json: async () => CREATED_ISSUE,
      text: async () => '',
    });
    await flushSelfIssueWrites();
    expect((await getTodo(s.app, created.id)).sourceRef).toBe(`github:${REPO}#101`);
    s.dispose();
  });

  test('W7/A11 retry after created -> 409; retry of an imported task -> 404; retry of a local task -> 404', async () => {
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE },
      [`GET ${issuePath(7)}`]: {
        body: { number: 7, title: 'imported', body: null, state: 'open', labels: [] },
      },
      [`GET /repos/${REPO}/labels`]: { body: [] },
    });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const created = await createTask(s.app, projectId);
    await flushSelfIssueWrites();
    const dup = await call(s.app, 'POST', `/api/todos/${created.id}/github-issue/retry`);
    expect(dup.status).toBe(409);
    expect(mock.callsTo('POST', ISSUES_PATH)).toHaveLength(1);
    const imported = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 7 },
    });
    const importedRec = todoRecordSchema.parse(await imported.json());
    expect(
      (await call(s.app, 'POST', `/api/todos/${importedRec.id}/github-issue/retry`)).status,
    ).toBe(404);
    const localProject = await postProject(s.app, 'plain');
    const local = await createTask(s.app, localProject);
    expect((await call(s.app, 'POST', `/api/todos/${local.id}/github-issue/retry`)).status).toBe(
      404,
    );
    expect((await call(s.app, 'POST', '/api/todos/todo-nope/github-issue/retry')).status).toBe(404);
    s.dispose();
  });

  test('W8/A7 the import path never triggers self-creation: zero POST issues across the whole import (no double issue)', async () => {
    const mock = ghMock({
      [`GET ${issuePath(7)}`]: {
        body: { number: 7, title: 'imported', body: 'b', state: 'open', labels: [] },
      },
      [`GET /repos/${REPO}/labels`]: { body: [] },
    });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 7 },
    });
    expect(res.status).toBe(201);
    const record = todoRecordSchema.parse(await res.json());
    expect(record.sourceKind).toBe('github-issue');
    await flushSelfIssueWrites();
    expect(mock.callsTo('POST', ISSUES_PATH)).toHaveLength(0);
    s.dispose();
  });
});

describe('title write-back and claim meta (B family)', () => {
  const AGENT_ID = 'agent-452';

  async function world(
    mock: GhMock,
    opts: { buildIssue: boolean },
  ): Promise<{ s: TestServer; token: string; step: ClaimedStep; todoId: string }> {
    const s = bootServer({ githubFetch: mock.impl, claimHoldMs: 250 });
    seedConnection(s);
    const plain = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: plain,
      body: { teamId: s.team.id, name: 'l452', cliVersion: '0.1.0' },
    });
    const { token } = (await enroll.json()) as { token: string };
    s.db
      .insert(agentTable)
      .values({
        id: AGENT_ID,
        teamId: s.team.id,
        displayName: 'meta',
        provider: 'p',
        modelId: 'm',
      })
      .run();
    bindAllAgents(s);

    const projectId = await postGithubProject(s.app);
    const created = await createTask(s.app, projectId);
    if (opts.buildIssue) await flushSelfIssueWrites();
    await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [created.id],
        assignment: { plan: null, build: { agentId: AGENT_ID } },
        withPlan: false,
      },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!step) throw new Error('no step claimed');
    return { s, token, step, todoId: created.id };
  }

  const relay = (app: Hono, token: string, stepId: string, params: Record<string, unknown>) =>
    call(app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: { name: 'set_task_meta', params },
    });

  test('W9/B1 title backfill on a created self-made task: stored locally + PATCH issue title (token only in headers)', async () => {
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE },
      [`PATCH ${issuePath(101)}`]: { body: { number: 101 } },
    });
    const { s, token, step, todoId } = await world(mock, { buildIssue: true });
    const res = await relay(s.app, token, step.step.id, { title: '正式标题' });
    expect(res.status).toBe(200);
    expect((await getTodo(s.app, todoId)).title).toBe('正式标题');
    const patches = mock.callsTo('PATCH', issuePath(101));
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0]!.body!)).toEqual({ title: '正式标题' });
    expect(patches[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(patches[0]!.url).not.toContain(TOKEN);
    s.dispose();
  });

  test('W10/B2 PATCH fails (issue deleted, 404): relay still 200, the local title stays applied, no rollback', async () => {
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE },
      [`PATCH ${issuePath(101)}`]: { status: 404, body: { message: 'Not Found' } },
    });
    const { s, token, step, todoId } = await world(mock, { buildIssue: true });
    const res = await relay(s.app, token, step.step.id, { title: '正式标题' });
    expect(res.status).toBe(200);
    expect((await getTodo(s.app, todoId)).title).toBe('正式标题');
    s.dispose();
  });

  test('W11/B3 title backfill on a not-yet-created task: local only, zero PATCH outbound (the later-created issue naturally uses the current title)', async () => {
    const mock = ghMock({ [`POST ${ISSUES_PATH}`]: { status: 502, body: {} } });
    const { s, token, step, todoId } = await world(mock, { buildIssue: true });
    expect((await getTodo(s.app, todoId)).sourceRef).toBeNull();
    const res = await relay(s.app, token, step.step.id, { title: '正式标题' });
    expect(res.status).toBe(200);
    expect((await getTodo(s.app, todoId)).title).toBe('正式标题');
    expect(mock.callsTo('PATCH', issuePath(101))).toHaveLength(0);
    s.dispose();
  });

  test('W13/B5 claim meta: self-created task (issue created) has titleFinal=false -- the backfill instruction is not short-circuited', async () => {
    const mock = ghMock({ [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE } });
    const { s, step, todoId } = await world(mock, { buildIssue: true });
    expect((await getTodo(s.app, todoId)).sourceRef).not.toBeNull();
    expect(step.todo?.meta?.titleFinal).toBe(false);
    s.dispose();
  });
});

describe('import dedup guardrails (C family)', () => {
  const LIST_BODY = [
    { number: 7, title: 'issue seven', state: 'open', labels: [] },
    { number: 9, title: 'issue nine', state: 'open', labels: [] },
  ];

  test('W14/C1+C2 list filtering: self-created and already-imported issues no longer appear, the rest unchanged', async () => {
    const mock = ghMock({
      [`GET ${ISSUES_PATH}`]: { body: LIST_BODY },
      [`GET ${issuePath(7)}`]: {
        body: { number: 7, title: 'issue seven', body: null, state: 'open', labels: [] },
      },
      [`GET /repos/${REPO}/labels`]: { body: [] },
      [`POST ${ISSUES_PATH}`]: { status: 201, body: { number: 9, title: 'x', state: 'open' } },
    });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const imported = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 7 },
    });
    expect(imported.status).toBe(201);
    const created = await createTask(s.app, projectId);
    await flushSelfIssueWrites();
    expect((await getTodo(s.app, created.id)).sourceRef).toBe(`github:${REPO}#9`);
    const list = await call(s.app, 'GET', `/api/projects/${projectId}/github/issues`);
    expect(list.status).toBe(200);
    const face = (await list.json()) as { issues: Array<{ number: number }> };
    expect(face.issues).toEqual([]);
    s.dispose();
  });

  test('W15/C3 direct POST importing an issue that already has a task -> 409 (same rule as self-created)', async () => {
    const mock = ghMock({
      [`GET ${ISSUES_PATH}`]: { body: LIST_BODY },
      [`GET ${issuePath(7)}`]: {
        body: { number: 7, title: 'issue seven', body: null, state: 'open', labels: [] },
      },
      [`GET /repos/${REPO}/labels`]: { body: [] },
      [`POST ${ISSUES_PATH}`]: { status: 201, body: { number: 9, title: 'x', state: 'open' } },
    });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const first = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 7 },
    });
    expect(first.status).toBe(201);
    const again = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 7 },
    });
    expect(again.status).toBe(409);
    const created = await createTask(s.app, projectId);
    await flushSelfIssueWrites();
    expect((await getTodo(s.app, created.id)).sourceRef).toBe(`github:${REPO}#9`);
    const selfImport = await call(
      s.app,
      'POST',
      `/api/projects/${projectId}/github/issues/import`,
      { body: { number: 9 } },
    );
    expect(selfImport.status).toBe(409);
    s.dispose();
  });
});

describe('GET /api/todos/{id}/github-issue read-only echo (D family)', () => {
  test('W16a created -> 200 with the upstream current values {number,title,state} (the data fetched once on entry)', async () => {
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE },
      [`GET ${issuePath(101)}`]: {
        body: { number: 101, title: '仓库侧改过的标题', state: 'closed', labels: [] },
      },
    });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const created = await createTask(s.app, projectId);
    await flushSelfIssueWrites();
    const res = await call(s.app, 'GET', `/api/todos/${created.id}/github-issue`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      number: 101,
      title: '仓库侧改过的标题',
      state: 'closed',
    });
    s.dispose();
  });

  test('W16b family cannot be fetched -> non-200: not-yet-created 404 / local task 404 / issue deleted 404 / connection removed 404', async () => {
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE },
      [`GET ${issuePath(101)}`]: {
        body: { number: 101, title: 't', state: 'open', labels: [] },
      },
    });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const localProject = await postProject(s.app, 'plain');
    const local = await createTask(s.app, localProject);
    expect((await call(s.app, 'GET', `/api/todos/${local.id}/github-issue`)).status).toBe(404);
    mock.set(`POST ${ISSUES_PATH}`, { status: 502, body: {} });
    const pending = await createTask(s.app, projectId);
    await flushSelfIssueWrites();
    expect((await getTodo(s.app, pending.id)).sourceRef).toBeNull();
    expect((await call(s.app, 'GET', `/api/todos/${pending.id}/github-issue`)).status).toBe(404);
    mock.set(`POST ${ISSUES_PATH}`, { status: 201, body: CREATED_ISSUE });
    const built = await createTask(s.app, projectId);
    await flushSelfIssueWrites();
    mock.set(`GET ${issuePath(101)}`, { status: 404, body: { message: 'Not Found' } });
    expect((await call(s.app, 'GET', `/api/todos/${built.id}/github-issue`)).status).toBe(404);
    mock.set(`GET ${issuePath(101)}`, {
      body: { number: 101, title: 't', state: 'open', labels: [] },
    });
    deleteGithubConnection({ db: s.db, box: s.secretBox }, s.team.id);
    expect((await call(s.app, 'GET', `/api/todos/${built.id}/github-issue`)).status).toBe(404);
    s.dispose();
  });
});

describe('moving a task with a self-created issue to another project (#2009)', () => {
  test('the old issue gets a comment and is closed as not planned, and a new issue opens in the new repo', async () => {
    const BETA = 'octo/beta';
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE },
      [`POST ${issuePath(101)}/comments`]: { status: 201, body: { id: 1 } },
      [`PATCH ${issuePath(101)}`]: { status: 200, body: { number: 101, state: 'closed' } },
      [`POST /repos/${BETA}/issues`]: { status: 201, body: { ...CREATED_ISSUE, number: 7 } },
    });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const alpha = await postGithubProject(s.app);
    const betaRes = await call(s.app, 'POST', '/api/projects', {
      body: { name: 'beta', kind: 'github', githubRepo: BETA },
    });
    const beta = ((await betaRes.json()) as { id: string }).id;
    const created = await createTask(s.app, alpha);
    await flushSelfIssueWrites();
    const moved = await call(s.app, 'PATCH', `/api/todos/${created.id}`, {
      body: { projectId: beta },
    });
    expect(moved.status).toBe(200);
    await flushSelfIssueWrites();
    await vi.waitFor(() => expect(mock.callsTo('PATCH', issuePath(101))).toHaveLength(1));
    expect(JSON.parse(mock.callsTo('PATCH', issuePath(101))[0]!.body!)).toEqual({
      state: 'closed',
      state_reason: 'not_planned',
    });
    expect(mock.callsTo('POST', `${issuePath(101)}/comments`)[0]!.body).toContain(`${BETA}#7`);
    const after = await getTodo(s.app, created.id);
    expect(after.projectId).toBe(beta);
    expect(after.sourceRef).toBe(`github:${BETA}#7`);
    s.dispose();
  });

  test('when the new repo refuses the issue, the old one stays open and linked until a retry succeeds', async () => {
    const BETA = 'octo/beta';
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE },
      [`POST ${issuePath(101)}/comments`]: { status: 201, body: { id: 1 } },
      [`PATCH ${issuePath(101)}`]: { status: 200, body: { number: 101, state: 'closed' } },
      [`POST /repos/${BETA}/issues`]: { status: 410, body: { message: 'Issues are disabled' } },
    });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const alpha = await postGithubProject(s.app);
    const betaRes = await call(s.app, 'POST', '/api/projects', {
      body: { name: 'beta', kind: 'github', githubRepo: BETA },
    });
    const beta = ((await betaRes.json()) as { id: string }).id;
    const created = await createTask(s.app, alpha);
    await flushSelfIssueWrites();
    await call(s.app, 'PATCH', `/api/todos/${created.id}`, { body: { projectId: beta } });
    await flushSelfIssueWrites();
    expect(mock.callsTo('POST', `/repos/${BETA}/issues`)).toHaveLength(1);
    expect(mock.callsTo('PATCH', issuePath(101))).toHaveLength(0);
    const stuck = await getTodo(s.app, created.id);
    expect(stuck.projectId).toBe(beta);
    expect(stuck.sourceRef).toBe(`github:${REPO}#101`);
    mock.set(`POST /repos/${BETA}/issues`, { status: 201, body: { ...CREATED_ISSUE, number: 7 } });
    const retry = await call(s.app, 'POST', `/api/todos/${created.id}/github-issue/retry`);
    expect(retry.status).toBe(200);
    await vi.waitFor(() => expect(mock.callsTo('PATCH', issuePath(101))).toHaveLength(1));
    expect((await getTodo(s.app, created.id)).sourceRef).toBe(`github:${BETA}#7`);
    s.dispose();
  });

  test('the old issue is closed with the token the connection holds after the replacement opens', async () => {
    const BETA = 'octo/beta';
    const ROTATED = 'ghp_rotated_token';
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE },
      [`POST ${issuePath(101)}/comments`]: { status: 201, body: { id: 1 } },
      [`PATCH ${issuePath(101)}`]: { status: 200, body: { number: 101, state: 'closed' } },
      [`POST /repos/${BETA}/issues`]: { status: 201, body: { ...CREATED_ISSUE, number: 7 } },
    });
    let rotate = (): void => undefined;
    const s = bootServer({
      githubFetch: async (input, init) => {
        const res = await mock.impl(input, init);
        if (new URL(String(input)).pathname === `/repos/${BETA}/issues`) rotate();
        return res;
      },
    });
    seedConnection(s);
    rotate = () =>
      upsertGithubConnection(
        { db: s.db, box: s.secretBox },
        { teamId: s.team.id, login: 'octo', accessToken: ROTATED, scope: 'repo' },
      );
    const alpha = await postGithubProject(s.app);
    const betaRes = await call(s.app, 'POST', '/api/projects', {
      body: { name: 'beta', kind: 'github', githubRepo: BETA },
    });
    const beta = ((await betaRes.json()) as { id: string }).id;
    const created = await createTask(s.app, alpha);
    await flushSelfIssueWrites();
    await call(s.app, 'PATCH', `/api/todos/${created.id}`, { body: { projectId: beta } });
    await flushSelfIssueWrites();
    const close = mock.callsTo('PATCH', issuePath(101));
    expect(close).toHaveLength(1);
    expect(close[0]!.headers.authorization).toBe(`Bearer ${ROTATED}`);
    s.dispose();
  });

  test('moving to a project without GitHub closes the old issue and clears the link', async () => {
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE },
      [`POST ${issuePath(101)}/comments`]: { status: 201, body: { id: 1 } },
      [`PATCH ${issuePath(101)}`]: { status: 200, body: { number: 101, state: 'closed' } },
    });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const alpha = await postGithubProject(s.app);
    const local = await postProject(s.app, 'local');
    const created = await createTask(s.app, alpha);
    await flushSelfIssueWrites();
    await call(s.app, 'PATCH', `/api/todos/${created.id}`, { body: { projectId: local } });
    await vi.waitFor(() => expect(mock.callsTo('PATCH', issuePath(101))).toHaveLength(1));
    const after = await getTodo(s.app, created.id);
    expect(after.sourceKind).toBeNull();
    expect(after.sourceRef).toBeNull();
    s.dispose();
  });
});
