// #452 / ADR 0006 写向：自派任务建时于 GitHub 建 issue（createTodo 收口，
// 关键路径之外）+ 回填标题写进 issue（setTaskMeta 收口）+ 导入去重护栏 +
// 来源 issue 只读回显。失败方式清单编号对位（A 建站 / B 回写 / C 护栏 /
// D 回显 / E 凭证面）。
// 出站纪律：token 只进 Authorization 头（never URL/响应），githubFetch 注入
// mock——测试面零真实出站。

import { type ClaimedStep, todoRecordSchema } from '@cairn/shared';
import type { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import {
  deleteGithubConnection,
  upsertGithubConnection,
} from '../src/services/github-connection.js';
import { flushSelfIssueWrites } from '../src/services/todos.js';
import { bindAllAgents, bootServer, issueApiKey, postProject, type TestServer } from './helpers.js';

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

// —— 出站 mock（github-issues.test.ts 同族，键扩为 `METHOD pathname`——写向
// 面 POST/GET 同径不同义，必须按动词分发）————————————————————————————

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

// —— A. 建 issue（createTodo 收口，关键路径之外）————————————————————

describe('自建 issue：落库即未建成，异步建成补来源（A 族）', () => {
  test('W1 已连接 github 项目建任务：201 即返（未建成态）→ 异步建成补 sourceRef + v++ + 文档事件；POST body = 标题+正文，token 只进头', async () => {
    const mock = ghMock({ [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE } });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const publishSpy = vi.spyOn(s.hub, 'publishTodoDoc');
    const spec = '给登录页加图形验证码\n\n要求：错误 5 次后触发。';
    const created = await createTask(s.app, projectId, spec);
    expect(created.status).toBe(201);
    // 落库即「未建成」：kind 已标、ref 尚空（状态值在来源列上，不新开列）
    expect(created.record?.sourceKind).toBe('github-issue-self');
    expect(created.record?.sourceRef).toBeNull();
    await flushSelfIssueWrites();
    const after = await getTodo(s.app, created.id);
    expect(after.sourceRef).toBe(`github:${REPO}#101`);
    expect(after.v).toBe((created.record?.v ?? 0) + 1);
    // 文档事件带补全后的记录（看板实时刷新，A14）
    const published = publishSpy.mock.calls.map(([, rec]) => rec);
    expect(published.some((r) => r.sourceRef === `github:${REPO}#101`)).toBe(true);
    // 出站面：POST body = 派生占位标题 + 任务正文（D3：占位标题单源）
    const posts = mock.callsTo('POST', ISSUES_PATH);
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]!.body!)).toEqual({ title: '给登录页加图形验证码', body: spec });
    // E2 token 纪律：头里有、URL 里没有
    expect(posts[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(posts[0]!.url).not.toContain(TOKEN);
    s.dispose();
  });

  test('W2/A6 关键路径硬约束：GitHub 出站挂起 → 建任务请求照常立即返回，零 GitHub await', async () => {
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
    // 出站从未 resolve，请求仍然落了：延迟与 GitHub 无关（同步本地路径）
    expect(created.elapsedMs).toBeLessThan(2000);
    expect(created.record?.sourceKind).toBe('github-issue-self');
    expect(created.record?.sourceRef).toBeNull();
    // 放行挂起的出站 → 异步补来源（证明是同一枚 in-flight 写出，非重发）
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

  test('W3/A2-A5 建不成（权限 404 / 限流 429 / 网络断 / 应答畸形）：任务照建成功，停留未建成，无未处理拒绝', async () => {
    const failures: Array<{ key: string; res: GhResponse | 'throw' }> = [
      { key: '404', res: { status: 404, body: { message: 'Not Found' } } },
      { key: '429', res: { status: 429, body: { message: 'rate limited' } } },
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
      expect(created.status, f.key).toBe(201); // 失败不阻断（D2）
      await flushSelfIssueWrites();
      const after = await getTodo(s.app, created.id);
      expect(after.sourceKind, f.key).toBe('github-issue-self');
      expect(after.sourceRef, f.key).toBeNull(); // 停留未建成，可重试
      s.dispose();
    }
  });

  test('W4/A1 未连接 github 项目：不建、零出站、两列 null（不亮任何失败态）', async () => {
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

  test('W5/A8 local(hosted) 项目：零出站、两列 null（现行为逐字节不变）', async () => {
    const mock = ghMock({});
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s); // 已连接也不建——形态闸在前
    const projectId = await postProject(s.app);
    const created = await createTask(s.app, projectId);
    expect(created.status).toBe(201);
    expect(created.record?.sourceKind).toBeNull();
    expect(created.record?.sourceRef).toBeNull();
    await flushSelfIssueWrites();
    expect(mock.calls).toHaveLength(0);
    s.dispose();
  });

  test('W6/A13 重试成功用当前标题：agent/用户改题后重试 → issue 标题 = 新题，来源补上', async () => {
    const mock = ghMock({ [`POST ${ISSUES_PATH}`]: { status: 404, body: { message: 'no' } } });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const created = await createTask(s.app, projectId);
    await flushSelfIssueWrites();
    expect((await getTodo(s.app, created.id)).sourceRef).toBeNull();
    // 本地改题（PATCH 既有面）
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

  test('W7/A10 重试竞态：fire-and-forget 在飞时重试 → 409 不双建；放行后来源落定', async () => {
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
    expect(retry.status).toBe(409); // 在飞 → 拒，不双建
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

  test('W7/A11 已建成重试 → 409；导入任务重试 → 404；local 任务重试 → 404', async () => {
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
    expect(mock.callsTo('POST', ISSUES_PATH)).toHaveLength(1); // 没有第二枚
    // 导入任务（sourceKind='github-issue'）→ 404（非自建来源）
    const imported = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 7 },
    });
    const importedRec = todoRecordSchema.parse(await imported.json());
    expect(
      (await call(s.app, 'POST', `/api/todos/${importedRec.id}/github-issue/retry`)).status,
    ).toBe(404);
    // local 任务 → 404
    const localProject = await postProject(s.app, 'plain');
    const local = await createTask(s.app, localProject);
    expect((await call(s.app, 'POST', `/api/todos/${local.id}/github-issue/retry`)).status).toBe(
      404,
    );
    // 不存在的 todo → 404
    expect((await call(s.app, 'POST', '/api/todos/todo-nope/github-issue/retry')).status).toBe(404);
    s.dispose();
  });

  test('W8/A7 导入路径不触发自建：import 全程零 POST issues（防双 issue）', async () => {
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

// —— B. 回写标题（setTaskMeta 收口）+ claim meta ————————————————————————

describe('标题回写与 claim meta（B 族）', () => {
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
    bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）

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

  test('W9/B1 自建已建成任务回填标题：本地落库 + PATCH issue 标题（token 只进头）', async () => {
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

  test('W10/B2 PATCH 失败（issue 被删 404）：relay 仍 200，本地标题已生效不回滚', async () => {
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

  test('W11/B3 自建未建成任务回填标题：只落本地，零 PATCH 出站（后建 issue 自然用当前标题）', async () => {
    const mock = ghMock({ [`POST ${ISSUES_PATH}`]: { status: 502, body: {} } });
    const { s, token, step, todoId } = await world(mock, { buildIssue: true });
    expect((await getTodo(s.app, todoId)).sourceRef).toBeNull(); // 建站失败
    const res = await relay(s.app, token, step.step.id, { title: '正式标题' });
    expect(res.status).toBe(200);
    expect((await getTodo(s.app, todoId)).title).toBe('正式标题');
    expect(mock.callsTo('PATCH', issuePath(101))).toHaveLength(0);
    s.dispose();
  });

  test('W13/B5 claim meta：自建任务（issue 已建成）titleFinal=false——回填指令不被短路', async () => {
    const mock = ghMock({ [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE } });
    const { s, step, todoId } = await world(mock, { buildIssue: true });
    expect((await getTodo(s.app, todoId)).sourceRef).not.toBeNull(); // 建成在先
    expect(step.todo?.meta?.titleFinal).toBe(false); // 仍走回填（ADR 0006 D3）
    s.dispose();
  });
});

// —— C. 导入去重护栏（D4：一条 issue 至多一个任务）————————————————————

describe('导入去重护栏（C 族）', () => {
  const LIST_BODY = [
    { number: 7, title: 'issue seven', state: 'open', labels: [] },
    { number: 9, title: 'issue nine', state: 'open', labels: [] },
  ];

  test('W14/C1+C2 列表滤除：自建的与导入过的 issue 都不再出现，其余照常', async () => {
    const mock = ghMock({
      [`GET ${ISSUES_PATH}`]: { body: LIST_BODY },
      [`GET ${issuePath(7)}`]: {
        body: { number: 7, title: 'issue seven', body: null, state: 'open', labels: [] },
      },
      [`GET /repos/${REPO}/labels`]: { body: [] },
      // 自建落 #9：与列表第二条同号（模拟「自派的 issue 出现在仓库列表」）
      [`POST ${ISSUES_PATH}`]: { status: 201, body: { number: 9, title: 'x', state: 'open' } },
    });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    // 导入 #7
    const imported = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 7 },
    });
    expect(imported.status).toBe(201);
    // 自建落 #9
    const created = await createTask(s.app, projectId);
    await flushSelfIssueWrites();
    expect((await getTodo(s.app, created.id)).sourceRef).toBe(`github:${REPO}#9`);
    // 列表：7（导入过）与 9（自建）都被滤除
    const list = await call(s.app, 'GET', `/api/projects/${projectId}/github/issues`);
    expect(list.status).toBe(200);
    const face = (await list.json()) as { issues: Array<{ number: number }> };
    expect(face.issues).toEqual([]);
    s.dispose();
  });

  test('W15/C3 直 POST 导入已有任务的 issue → 409（自建的同律）', async () => {
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
    expect(selfImport.status).toBe(409); // 自建的 issue 不吃回来（D4）
    s.dispose();
  });
});

// —— D. 来源 issue 只读回显（D5/D6）———————————————————————————————————

describe('GET /api/todos/{id}/github-issue 只读回显（D 族）', () => {
  test('W16a 已建成 → 200 上游现值 {number,title,state}（进入时拉一次的数据面）', async () => {
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

  test('W16b 拉不到整族 → 非 200：未建成 404 / local 任务 404 / issue 被删 404 / 连接已断 404', async () => {
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: CREATED_ISSUE },
      [`GET ${issuePath(101)}`]: {
        body: { number: 101, title: 't', state: 'open', labels: [] },
      },
    });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    // local 任务（无来源）→ 404
    const localProject = await postProject(s.app, 'plain');
    const local = await createTask(s.app, localProject);
    expect((await call(s.app, 'GET', `/api/todos/${local.id}/github-issue`)).status).toBe(404);
    // 未建成（POST 失败）→ 404
    mock.set(`POST ${ISSUES_PATH}`, { status: 502, body: {} });
    const pending = await createTask(s.app, projectId);
    await flushSelfIssueWrites();
    expect((await getTodo(s.app, pending.id)).sourceRef).toBeNull();
    expect((await call(s.app, 'GET', `/api/todos/${pending.id}/github-issue`)).status).toBe(404);
    // 已建成但 issue 被删（上游 404）→ 404 直透
    mock.set(`POST ${ISSUES_PATH}`, { status: 201, body: CREATED_ISSUE });
    const built = await createTask(s.app, projectId);
    await flushSelfIssueWrites();
    mock.set(`GET ${issuePath(101)}`, { status: 404, body: { message: 'Not Found' } });
    expect((await call(s.app, 'GET', `/api/todos/${built.id}/github-issue`)).status).toBe(404);
    // 连接已断 → 404
    mock.set(`GET ${issuePath(101)}`, {
      body: { number: 101, title: 't', state: 'open', labels: [] },
    });
    deleteGithubConnection({ db: s.db, box: s.secretBox }, s.team.id);
    expect((await call(s.app, 'GET', `/api/todos/${built.id}/github-issue`)).status).toBe(404);
    s.dispose();
  });
});
