// #446 / ADR 0005 读向：GitHub issue 读面（列表 + 导入建任务）+ 仓库 label
// 镜像同步 + 词表不变式两形态分叉 + claim 载荷 meta 注入位。
// 失败方式清单 = /tmp 施工信封产物（本票 Testing Decisions），编号对位：
// B4-B11 读面闸与上游映射；C12-C16 标签同步（颜色归一/幂等/删 label 保留
// 行/github 不播种 6 词）；D17-D22 导入落值（标题原样/来源两列/多标签/
// 先 fetch 后建）；E23-E26 set_task_meta 两形态校验；F27-F28 claim meta。
// 出站纪律：token 只进 Authorization 头（never URL/响应），githubFetch 注入
// mock——测试面零真实出站（H37）。

import {
  type ClaimedStep,
  FIXED_TAGS,
  githubIssuesResponseSchema,
  todoRecordSchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  project as projectTable,
  tag as tagTable,
  todo as todoTable,
  todoTag,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/github.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { importGithubIssue } from '../src/services/github-issues.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const TOKEN = 'ghp_issue_face_token';
const REPO = 'octo/alpha';

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

// —— 出站 mock（github-connection.test.ts 同族，扩展为按 pathname 分发）————

export interface GhCall {
  url: string;
  headers: Record<string, string>;
}

interface GhResponse {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

type GhRoute = GhResponse | ((url: URL) => GhResponse);

/** 按 URL pathname 分发的可编程 mock；未配置路径 = 404（防测试面漏配静默
 * 打到兜底）。calls 记录全部出站（URL + 头，供 token 纪律断言）；set 支持
 * 同一 boot 内换上游应答（C14 仓库侧删 label 场景）。 */
function ghMock(initial: Record<string, GhRoute>) {
  const routes = new Map<string, GhRoute>(Object.entries(initial));
  const calls: GhCall[] = [];
  const impl: FetchLike = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: { ...(init?.headers ?? {}) } });
    const parsed = new URL(url);
    const route = routes.get(parsed.pathname);
    const res =
      route === undefined
        ? { status: 404, body: { message: `no mock for ${parsed.pathname}` } }
        : typeof route === 'function'
          ? route(parsed)
          : route;
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
    set(path: string, res: GhRoute): void {
      routes.set(path, res);
    },
  };
}

const ISSUES_PATH = `/repos/${REPO}/issues`;
const LABELS_PATH = `/repos/${REPO}/labels`;
const issuePath = (n: number) => `/repos/${REPO}/issues/${n}`;

// —— 数据面 fixture（上游形状原样：snake_case + label color 无 # 前缀）—————

const ISSUE_7_TITLE =
  '登录偶发 500：会话过期后重试风暴打挂鉴权上游——这个标题超过五十个字符必须原样保留不截断';
const ISSUE_7_LABELS = [
  { name: 'bug', color: 'd73a4a', description: 'Something is broken' },
  { name: 'area:auth', color: '0075ca', description: null },
];

const ISSUES_LIST = [
  { number: 7, title: ISSUE_7_TITLE, state: 'open', labels: ISSUE_7_LABELS },
  // PR 条目混入（GitHub /issues 语义）：pull_request 键 → lib 层滤除（B8）
  { number: 8, title: 'A pull request', state: 'open', labels: [], pull_request: { url: 'x' } },
  // 畸形条目：缺 number → 跳过（B7）
  { title: 'no number here', state: 'open', labels: [] },
  { number: 9, title: 'second issue', state: 'open', labels: [{ name: 'bug', color: 'd73a4a' }] },
];

const ISSUE_7_DETAIL = {
  number: 7,
  title: ISSUE_7_TITLE,
  body: '复现步骤：会话过期后连点重试。\n\n期望：退避。',
  state: 'open',
  labels: ISSUE_7_LABELS,
};

const ISSUE_9_DETAIL = {
  number: 9,
  title: 'second issue',
  body: null, // D18：body null → spec 空串
  state: 'open',
  labels: [{ name: 'bug', color: 'd73a4a' }],
};

const LABELS_FULL = [
  { name: 'bug', color: 'd73a4a', description: 'Something is broken' },
  { name: 'area:auth', color: '0075ca', description: null },
  { name: 'help wanted', color: '008672', description: 'Extra attention is welcome' },
];

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
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** 标准出站面：列表 + 单 issue + labels 全配好；测试覆写个别路径。 */
function defaultRoutes(overrides: Record<string, GhResponse | ((url: URL) => GhResponse)> = {}) {
  return {
    [ISSUES_PATH]: { body: ISSUES_LIST } as GhResponse,
    [issuePath(7)]: { body: ISSUE_7_DETAIL } as GhResponse,
    [issuePath(9)]: { body: ISSUE_9_DETAIL } as GhResponse,
    [LABELS_PATH]: { body: LABELS_FULL } as GhResponse,
    ...overrides,
  };
}

function projectTags(s: TestServer, projectId: string) {
  return s.db.select().from(tagTable).where(eq(tagTable.projectId, projectId)).all();
}

// —— B. 读面闸与上游映射 ————————————————————————————————————————————————

describe('GET /api/projects/{id}/github/issues（B4-B11）', () => {
  test('B4 形态错配：local(plain)/hosted 项目 → 404，不出站', async () => {
    const mock = ghMock(defaultRoutes());
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postProject(s.app); // plain 项目（无 repoKind）
    const res = await call(s.app, 'GET', `/api/projects/${projectId}/github/issues`);
    expect(res.status).toBe(404);
    expect(mock.calls).toHaveLength(0);
    s.dispose();
  });

  test('B5 未连接：github 项目无 connection → 404，不出站', async () => {
    const mock = ghMock(defaultRoutes());
    const s = bootServer({ githubFetch: mock.impl });
    const projectId = await postGithubProject(s.app);
    const res = await call(s.app, 'GET', `/api/projects/${projectId}/github/issues`);
    expect(res.status).toBe(404);
    expect(mock.calls).toHaveLength(0);
    s.dispose();
  });

  test('B3/B6/B10 代理面：state/page 透传上游，token 只进 Authorization 头', async () => {
    const mock = ghMock(defaultRoutes());
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const res = await call(
      s.app,
      'GET',
      `/api/projects/${projectId}/github/issues?state=closed&page=2`,
    );
    expect(res.status).toBe(200);
    expect(mock.calls).toHaveLength(1);
    const url = new URL(mock.calls[0]!.url);
    expect(url.origin + url.pathname).toBe(`https://api.github.com${ISSUES_PATH}`);
    expect(url.searchParams.get('state')).toBe('closed');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('per_page')).toMatch(/^\d+$/);
    // token 纪律：头里有、URL 里没有、响应体里没有
    expect(mock.calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(mock.calls[0]!.url).not.toContain(TOKEN);
    const raw = await res.text();
    expect(raw).not.toContain(TOKEN);
    s.dispose();
  });

  test('B7/B8 封套：PR 条目滤除、畸形条目跳过、shape 过 schema', async () => {
    const mock = ghMock(defaultRoutes());
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const res = await call(s.app, 'GET', `/api/projects/${projectId}/github/issues`);
    const envelope = githubIssuesResponseSchema.parse(await res.json());
    expect(envelope.issues.map((i) => i.number)).toEqual([7, 9]);
    // 颜色归一在 server 出线前单点做：wire 面恒 #rrggbb
    expect(envelope.issues[0]!.labels).toEqual([
      { name: 'bug', color: '#d73a4a' },
      { name: 'area:auth', color: '#0075ca' },
    ]);
    s.dispose();
  });

  test('B10 hasMore：Link 头 rel=next → true；缺 Link → false', async () => {
    const withLink = ghMock(
      defaultRoutes({
        [ISSUES_PATH]: {
          headers: { link: '<https://api.github.com/x?page=2>; rel="next"' },
          body: ISSUES_LIST,
        },
      }),
    );
    const s1 = bootServer({ githubFetch: withLink.impl });
    seedConnection(s1);
    const p1 = await postGithubProject(s1.app);
    const r1 = githubIssuesResponseSchema.parse(
      await (await call(s1.app, 'GET', `/api/projects/${p1}/github/issues`)).json(),
    );
    expect(r1.hasMore).toBe(true);
    s1.dispose();

    const noLink = ghMock(defaultRoutes());
    const s2 = bootServer({ githubFetch: noLink.impl });
    seedConnection(s2);
    const p2 = await postGithubProject(s2.app);
    const r2 = githubIssuesResponseSchema.parse(
      await (await call(s2.app, 'GET', `/api/projects/${p2}/github/issues`)).json(),
    );
    expect(r2.hasMore).toBe(false);
    s2.dispose();
  });

  test('B10 参数闸：state 非法 / page 非法 → 400，不出站', async () => {
    const mock = ghMock(defaultRoutes());
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    expect(
      (await call(s.app, 'GET', `/api/projects/${projectId}/github/issues?state=bogus`)).status,
    ).toBe(400);
    expect(
      (await call(s.app, 'GET', `/api/projects/${projectId}/github/issues?page=0`)).status,
    ).toBe(400);
    expect(
      (await call(s.app, 'GET', `/api/projects/${projectId}/github/issues?page=abc`)).status,
    ).toBe(400);
    expect(mock.calls).toHaveLength(0);
    s.dispose();
  });

  test('B9 上游映射：404 → 404；限流 403+remaining=0 → 429', async () => {
    const notFound = ghMock(defaultRoutes({ [ISSUES_PATH]: { status: 404, body: {} } }));
    const s1 = bootServer({ githubFetch: notFound.impl });
    seedConnection(s1);
    const p1 = await postGithubProject(s1.app);
    expect((await call(s1.app, 'GET', `/api/projects/${p1}/github/issues`)).status).toBe(404);
    s1.dispose();

    const limited = ghMock(
      defaultRoutes({
        [ISSUES_PATH]: { status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: {} },
      }),
    );
    const s2 = bootServer({ githubFetch: limited.impl });
    seedConnection(s2);
    const p2 = await postGithubProject(s2.app);
    expect((await call(s2.app, 'GET', `/api/projects/${p2}/github/issues`)).status).toBe(429);
    s2.dispose();
  });
});

// —— C. 词表分叉的播种面 + D. 导入建任务 + 标签同步 —————————————————————

describe('github 项目标签词表 = 仓库 label 镜像（C12-C16）', () => {
  test('C16 github 项目创建不播种 6 词；plain/local 项目播种不变', async () => {
    const s = bootServer();
    const ghId = await postGithubProject(s.app);
    expect(projectTags(s, ghId)).toHaveLength(0);
    const plainId = await postProject(s.app);
    expect(projectTags(s, plainId).map((t) => t.name)).toEqual(FIXED_TAGS.map((t) => t.name));
    s.dispose();
  });

  test('C12/C13/C15 导入同步：新 label 建行（color 补 #）、二次导入被去重护栏拒绝', async () => {
    const mock = ghMock(defaultRoutes());
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const r1 = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 7 },
    });
    expect(r1.status).toBe(201);
    const tags = projectTags(s, projectId);
    // issue 7 的两个 label + 仓库 label 集全量镜像（help wanted 同步建行）
    expect(tags.map((t) => t.name).sort()).toEqual(['area:auth', 'bug', 'help wanted']);
    const bug = tags.find((t) => t.name === 'bug')!;
    expect(bug.color).toBe('#d73a4a'); // C12：上游无 # → 补 #
    // #452 / ADR 0006 D4：一条 issue 至多一个任务——再导一次 issue 7 → 409，
    // 标签行不动（护栏在出站之前，label 幂等面由 C13 的换 issue 导入覆盖）。
    const r2 = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 7 },
    });
    expect(r2.status).toBe(409);
    expect(projectTags(s, projectId)).toHaveLength(3);
    s.dispose();
  });

  test('C13 既有行颜色跟随 GitHub 真值更新', async () => {
    // 仓库集与 issue 集同刻现拉，上游真值一致（bug 已改色 fbca04）
    const mock = ghMock(
      defaultRoutes({
        [LABELS_PATH]: {
          body: [{ name: 'bug', color: 'fbca04', description: null }],
        },
        [issuePath(9)]: {
          body: {
            ...ISSUE_9_DETAIL,
            labels: [{ name: 'bug', color: 'fbca04' }],
          },
        },
      }),
    );
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    // 先手工种一行旧色（模拟既有镜像行）
    await call(s.app, 'POST', `/api/projects/${projectId}/tags`, {
      body: { name: 'bug', color: '#6366f1' },
    });
    await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 9 },
    });
    const bug = projectTags(s, projectId).find((t) => t.name === 'bug')!;
    expect(bug.color).toBe('#fbca04');
    expect(projectTags(s, projectId).filter((t) => t.name === 'bug')).toHaveLength(1);
    s.dispose();
  });

  test('C14 仓库侧删 label：行保留，已挂 todo_tag 不动', async () => {
    const mock = ghMock(defaultRoutes());
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const first = todoRecordSchema.parse(
      await (
        await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
          body: { number: 7 },
        })
      ).json(),
    );
    expect(first.tagIds).toHaveLength(2);
    // 仓库侧删掉 area:auth 后导入 issue 9（labels 只剩 bug）
    mock.set(LABELS_PATH, { body: [{ name: 'bug', color: 'd73a4a' }] });
    await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 9 },
    });
    const tags = projectTags(s, projectId);
    expect(tags.map((t) => t.name).sort()).toEqual(['area:auth', 'bug', 'help wanted']);
    const reloaded = todoRecordSchema.parse(
      await (await call(s.app, 'GET', `/api/todos/${first.id}`)).json(),
    );
    expect(reloaded.tagIds).toHaveLength(2); // 已挂标签未被级联摘除
    const links = s.db.select().from(todoTag).where(eq(todoTag.todoId, first.id)).all();
    expect(links).toHaveLength(2);
    s.dispose();
  });
});

describe('POST /api/projects/{id}/github/issues/import（D17-D22）', () => {
  test('D17/D18/D19/D20 导入落值：标题原样、spec=body、来源两列、多标签', async () => {
    const mock = ghMock(defaultRoutes());
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 7 },
    });
    expect(res.status).toBe(201);
    const record = todoRecordSchema.parse(await res.json());
    expect(record.title).toBe(ISSUE_7_TITLE); // >50 字符原样，不截断不派生
    expect(record.spec).toBe(ISSUE_7_DETAIL.body);
    expect(record.sourceKind).toBe('github-issue');
    expect(record.sourceRef).toBe(`github:${REPO}#7`);
    expect(record.projectId).toBe(projectId);
    expect(record.phase).toBe('todo');
    const tagNames = projectTags(s, projectId)
      .filter((t) => record.tagIds.includes(t.id))
      .map((t) => t.name)
      .sort();
    expect(tagNames).toEqual(['area:auth', 'bug']); // issue 挂几个贴几个
    s.dispose();
  });

  test('D18 body null → spec 空串', async () => {
    const mock = ghMock(defaultRoutes());
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 9 },
    });
    const record = todoRecordSchema.parse(await res.json());
    expect(record.spec).toBe('');
    s.dispose();
  });

  test('D21 issue 不存在 → 404，不留半成品任务', async () => {
    const mock = ghMock(
      defaultRoutes({ [issuePath(404)]: { status: 404, body: { message: 'Not Found' } } }),
    );
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 404 },
    });
    expect(res.status).toBe(404);
    const todos = await (await call(s.app, 'GET', `/api/projects/${projectId}/todos`)).json();
    expect(todos).toEqual([]);
    s.dispose();
  });

  test('D13/D19 形态与连接闸：plain 项目 404；未连接 404；普通建任务来源两列 null', async () => {
    const mock = ghMock(defaultRoutes());
    const s = bootServer({ githubFetch: mock.impl });
    const plainId = await postProject(s.app);
    expect(
      (
        await call(s.app, 'POST', `/api/projects/${plainId}/github/issues/import`, {
          body: { number: 7 },
        })
      ).status,
    ).toBe(404);
    const ghId = await postGithubProject(s.app);
    expect(
      (
        await call(s.app, 'POST', `/api/projects/${ghId}/github/issues/import`, {
          body: { number: 7 },
        })
      ).status,
    ).toBe(404);
    seedConnection(s);
    // 普通建任务面（local 行为逐字节不变的 wire 位）：两列 null
    const normal = todoRecordSchema.parse(
      await (
        await call(s.app, 'POST', `/api/projects/${plainId}/todos`, {
          body: { title: '', spec: '普通任务正文' },
        })
      ).json(),
    );
    expect(normal.sourceKind).toBeNull();
    expect(normal.sourceRef).toBeNull();
    s.dispose();
  });

  test('D 参数闸：number 缺失/非正整数 → 400', async () => {
    const mock = ghMock(defaultRoutes());
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    expect(
      (await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, { body: {} }))
        .status,
    ).toBe(400);
    expect(
      (
        await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
          body: { number: 0 },
        })
      ).status,
    ).toBe(400);
    s.dispose();
  });
});

// —— E/F. set_task_meta 两形态 + claim meta（worker world 同 task-meta.test）——

describe('set_task_meta 词表不变式两形态（E23-E26 / F27-F28）', () => {
  const AGENT_ID = 'agent-446';

  async function world(kind: 'github' | 'plain', viaImport: boolean) {
    const mock = ghMock(defaultRoutes());
    const s = bootServer({ githubFetch: mock.impl, claimHoldMs: 250 });
    if (kind === 'github') seedConnection(s);
    const plain = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: plain,
      body: { teamId: s.team.id, name: 'l446', cliVersion: '0.1.0' },
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

    const projectId = kind === 'github' ? await postGithubProject(s.app) : await postProject(s.app);
    let todoId: string;
    if (viaImport) {
      const res = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
        body: { number: 7 },
      });
      todoId = todoRecordSchema.parse(await res.json()).id;
    } else {
      const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        body: { title: '', spec: '给登录页加图形验证码' },
      });
      todoId = ((await todoRes.json()) as { id: string }).id;
    }
    await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [todoId],
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
    return { s, token, step, projectId, todoId, mock };
  }

  const relay = (app: Hono, token: string, stepId: string, params: Record<string, unknown>) =>
    call(app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: { name: 'set_task_meta', params },
    });

  test('F27 local(plain) claim：todo.meta 缺省，工具面 = 单 tag 形（现行为不变）', async () => {
    const { s, step } = await world('plain', false);
    expect(step.todo?.meta).toBeUndefined();
    const def = step.remoteTools?.find((t) => t.name === 'set_task_meta');
    expect(def).toBeDefined();
    const params = def!.parameters as { required?: string[]; properties: Record<string, unknown> };
    expect(params.required).toEqual(['title']);
    expect(Object.keys(params.properties).sort()).toEqual(['tag', 'title']);
    s.dispose();
  });

  test('F28 github + issue 来源 claim：meta.titleFinal=true，vocab=镜像 name 列，工具面 = tags 数组形', async () => {
    const { s, step } = await world('github', true);
    const meta = step.todo?.meta;
    expect(meta).toBeDefined();
    expect(meta!.titleFinal).toBe(true);
    expect(meta!.vocab).toEqual([
      { name: expect.any(String) },
      { name: expect.any(String) },
      { name: expect.any(String) },
    ]);
    expect(meta!.vocab.map((v) => v.name).sort()).toEqual(['area:auth', 'bug', 'help wanted']);
    const def = step.remoteTools?.find((t) => t.name === 'set_task_meta');
    const params = def!.parameters as { required?: string[]; properties: Record<string, unknown> };
    expect(params.required).toBeUndefined();
    expect(Object.keys(params.properties).sort()).toEqual(['tags', 'title']);
    s.dispose();
  });

  test('F28 github 手工建任务 claim：meta.titleFinal=false（占位标题仍走回填）', async () => {
    const { s, step } = await world('github', false);
    const meta = step.todo?.meta;
    expect(meta).toBeDefined();
    expect(meta!.titleFinal).toBe(false);
    expect(meta!.vocab).toEqual([]); // 未导入过 = 无镜像行（F30 空词表面）
    s.dispose();
  });

  test('E24 github relay：tags 数组多枚落值；集合外 name 400；title/tags 全缺 400', async () => {
    const { s, token, step, todoId } = await world('github', true);
    const ok = await relay(s.app, token, step.step.id, { tags: ['bug', 'help wanted'] });
    expect(ok.status).toBe(200);
    const one = todoRecordSchema.parse(
      await (await call(s.app, 'GET', `/api/todos/${todoId}`)).json(),
    );
    const names = projectTags(s, one.projectId)
      .filter((t) => one.tagIds.includes(t.id))
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(['bug', 'help wanted']);
    const bad = await relay(s.app, token, step.step.id, { tags: ['bug', 'not-in-project'] });
    expect(bad.status).toBe(400);
    const empty = await relay(s.app, token, step.step.id, {});
    expect(empty.status).toBe(400);
    s.dispose();
  });

  test('E26 github relay 兼容旧形单 tag 字符串（混部容忍，仅 tags 面）', async () => {
    const { s, token, step, todoId } = await world('github', true);
    const res = await relay(s.app, token, step.step.id, { tag: 'bug' });
    expect(res.status).toBe(200);
    const one = todoRecordSchema.parse(
      await (await call(s.app, 'GET', `/api/todos/${todoId}`)).json(),
    );
    expect(one.tagIds).toHaveLength(1);
    s.dispose();
  });

  test('titleFinal 机械闸（AC「不被回填覆盖」）：issue 来源任务带 title = 400，tags 仍放行；手工建任务 title 放行', async () => {
    // issue 来源：标题已真值，覆写被拒（提示词面不注入是第一道，本闸第二道）
    const gh = await world('github', true);
    const blocked = await relay(gh.s.app, gh.token, gh.step.step.id, { title: 'agent 想改标题' });
    expect(blocked.status).toBe(400);
    const allowed = await relay(gh.s.app, gh.token, gh.step.step.id, { tags: ['bug'] });
    expect(allowed.status).toBe(200);
    const untouched = todoRecordSchema.parse(
      await (await call(gh.s.app, 'GET', `/api/todos/${gh.todoId}`)).json(),
    );
    expect(untouched.title).toBe(ISSUE_7_TITLE);
    gh.s.dispose();
    // 手工建的 github 任务：占位标题仍走回填（titleFinal=false）
    const manual = await world('github', false);
    const ok = await relay(manual.s.app, manual.token, manual.step.step.id, { title: '正式标题' });
    expect(ok.status).toBe(200);
    const reloaded = todoRecordSchema.parse(
      await (await call(manual.s.app, 'GET', `/api/todos/${manual.todoId}`)).json(),
    );
    expect(reloaded.title).toBe('正式标题');
    manual.s.dispose();
  });

  test('E23 local(plain) relay：FIXED_TAGS 白名单不变——自定义 tag 行也拒', async () => {
    const { s, token, step, projectId } = await world('plain', false);
    // local 项目手工加一行自定义 tag（POST tags 既有面）
    await call(s.app, 'POST', `/api/projects/${projectId}/tags`, {
      body: { name: 'urgent', color: '#ef4444' },
    });
    const bad = await relay(s.app, token, step.step.id, { title: 'x', tag: 'urgent' });
    expect(bad.status).toBe(400); // 白名单优先于 tag 集（local 逐字节不变）
    const ok = await relay(s.app, token, step.step.id, { title: 'x', tag: 'feature' });
    expect(ok.status).toBe(200);
    s.dispose();
  });
});

// —— 溯源两列的 DB 面直查（A2/A19 落列证据）————————————————————————————

describe('todo 溯源两列（#446 D6）', () => {
  test('导入任务两列落值；级联面不动既有列', async () => {
    const mock = ghMock(defaultRoutes());
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const record = todoRecordSchema.parse(
      await (
        await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
          body: { number: 7 },
        })
      ).json(),
    );
    const rows = s.db
      .select()
      .from(tagTable)
      .where(and(eq(tagTable.projectId, projectId), eq(tagTable.name, 'bug')))
      .all();
    expect(rows).toHaveLength(1);
    expect(record.createdBy).not.toBeNull(); // 人工触发导入 = seed 用户
    s.dispose();
  });
});

// 出站零真实网络（H37）：以上全部经 githubFetch 注入 mock；再钉一条——
// 未配置路径的兜底 404 保证漏配不会静默打真上游。
describe('出站纪律', () => {
  test('mock 未配置路径 = 404（漏配显形）', async () => {
    const mock = ghMock({});
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const res = await req(s.app, 'GET', `/api/projects/${projectId}/github/issues`);
    expect(res.status).toBe(404); // 上游 404 经 lib 映射直透
    expect(mock.calls).toHaveLength(1);
    s.dispose();
  });
});

// —— #1406 并发导入占位（webhook 与轮询器同时导入同一 issue）——————————————
// claimedSourceRefs 是应用层检查、todo.sourceRef 无唯一约束；导入在检查与
// createTodo 之间要等两次 GitHub 读。进程内 sourceRef 占位在第一次 await 之前
// 落下、finally 里释放：同时进来的第二个导入拿到 409，一条 issue 一张卡。

describe('#1406 并发导入占位', () => {
  /** 每次读都让出事件循环（像真实网络），两路导入在读之间交错。 */
  function yielding(mock: ReturnType<typeof ghMock>): FetchLike {
    return async (input, init) => {
      await new Promise((r) => setTimeout(r, 0));
      return mock.impl(input, init);
    };
  }

  async function importWorld(fetchImpl: FetchLike) {
    const s = bootServer({ githubFetch: fetchImpl });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const row = s.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
    if (row === undefined) throw new Error('project missing');
    const deps = { ...s.svc, box: s.secretBox, githubFetch: fetchImpl };
    const issueTodos = () =>
      s.db
        .select()
        .from(todoTable)
        .where(eq(todoTable.sourceRef, `github:${REPO}#7`))
        .all();
    return { s, row, deps, issueTodos };
  }

  test('同一 issue 两路并发导入：一路建卡，另一路 409', async () => {
    const mock = ghMock(defaultRoutes());
    const { s, row, deps, issueTodos } = await importWorld(yielding(mock));
    const results = await Promise.allSettled([
      importGithubIssue(deps, row, 7),
      importGithubIssue(deps, row, 7),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    const reason = (rejected as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(HttpError);
    expect((reason as HttpError).status).toBe(409);
    expect(issueTodos()).toHaveLength(1);
    s.dispose();
  });

  test('不同 issue 并发导入互不阻塞', async () => {
    const mock = ghMock(defaultRoutes());
    const { s, row, deps } = await importWorld(yielding(mock));
    const [a, b] = await Promise.all([
      importGithubIssue(deps, row, 7),
      importGithubIssue(deps, row, 9),
    ]);
    expect([a.sourceRef, b.sourceRef].sort()).toEqual([`github:${REPO}#7`, `github:${REPO}#9`]);
    s.dispose();
  });

  test('导入失败（上游 5xx）释放占位：随后的导入照常建卡', async () => {
    const mock = ghMock(defaultRoutes({ [issuePath(7)]: { status: 500, body: {} } }));
    const { s, row, deps, issueTodos } = await importWorld(yielding(mock));
    await expect(importGithubIssue(deps, row, 7)).rejects.toMatchObject({ status: 502 });
    mock.set(issuePath(7), { body: ISSUE_7_DETAIL });
    const record = await importGithubIssue(deps, row, 7);
    expect(record.sourceRef).toBe(`github:${REPO}#7`);
    expect(issueTodos()).toHaveLength(1);
    s.dispose();
  });

  test('引用大小写不同也是同一条 issue：已有 github:Octo/Alpha#7 的卡 → 列表滤除 7、直接导入 409', async () => {
    const mock = ghMock(defaultRoutes());
    const { s, row, deps } = await importWorld(mock.impl);
    s.db
      .insert(todoTable)
      .values({
        id: 'todo-case-7',
        teamId: s.team.id,
        projectId: row.id,
        title: 'issue 7 under another case',
        spec: '',
        phase: 'todo',
        phaseAt: Date.now(),
        seqNum: 900,
        sourceKind: 'github-issue',
        sourceRef: 'github:Octo/Alpha#7',
      })
      .run();
    const list = await call(s.app, 'GET', `/api/projects/${row.id}/github/issues`);
    expect(list.status).toBe(200);
    const face = (await list.json()) as { issues: Array<{ number: number }> };
    expect(face.issues.map((i) => i.number)).toEqual([9]);
    await expect(importGithubIssue(deps, row, 7)).rejects.toMatchObject({ status: 409 });
    expect(
      s.db.select().from(todoTable).where(eq(todoTable.sourceKind, 'github-issue')).all(),
    ).toHaveLength(1);
    s.dispose();
  });
});
