// #1137 GitHub webhook 事件入口 tracer：receiver 全场景 + token mgmt +
// token-auth 豁免面。失败方式清单（先列后写，代码是让场景通过的手段）：
//
// A created 全链
//  A1 触发 label（pacman）labeled 事件 → 202 {result:'created'}，todo 行
//     sourceKind/sourceRef 落值 + chief_thread/chief_message/step 行（派发段）
//     + webhook_token.lastUsedAt 回写（落库段）；
//  A2 响应封套过 shared webhookReceiverResponseSchema（请求段对账）。
// B 重复/去重双层
//  B1 同 X-GitHub-Delivery 60s 窗口内二次投递 → 202 duplicate，无第二个
//     todo、无第二条 chief 线程；
//  B2 同 issue 不同 delivery（重放）→ importGithubIssue 409 → 202
//     duplicate（持久闸，不透 409 给 GitHub）。
// C ignored / noop
//  C1 ping 事件 → 202 ignored，零副作用（GitHub 建 webhook 首发）；
//  C2 未知事件（push）→ 202 ignored；
//  C3 非 labeled action / 非触发 label → 202 ignored；
//  C4 载荷形坏（缺 issue.number）→ 202 ignored（不 400）。
// D misconfigured / 上游
//  D1 repo 无映射项目 → 202 misconfigured；
//  D2 GitHub 未连接 → 202 misconfigured（#1459 起在 teamGithubToken 就拒；
//     importGithubIssue 自己的 404 收敛由 W16 覆盖：连接在权限读期间被删）；
//  D3 上游瞬时失败（网络 502）→ 502 直透（唯一喂 GitHub 重试的分支）。
// E token 面
//  E1 错 token → 401（{error} 同形），不写 lastUsedAt；
//  E2 吊销后投递 → 401；
//  E3 token mgmt：创建一次性明文 + 列表掩码（keyHash 永不出）+ 删除 204/
//     404；属他 team 的删除 → 404。
// F token-auth 豁免面
//  F1 PACMAN_TOKEN 开：receiver 免 Bearer 可达（错 token 仍 401——自有闸）；
//  F2 PACMAN_TOKEN 开：token mgmt 端点仍要 Bearer（401 无凭证）；
//  F3 /api/webhookfoo 段边界不豁免（401）。
// W #1459 打标人按 D5 核 + 计入在飞上限（清单 docs/verify/1459/failure-modes.txt，
//   W 编号对位）：sender 在仓库上 triage 及以上才导入，权限读与缓存复用 #1406
//   轮询器的；读不到 / 没 token / 到上限 = 不导入、记日志、202 带原因。
//   W4b（合入 #1406 round 4 后）：permission 读遇限流（429 / 带限流信号的
//   403）在 lib 里抛 GithubRateLimitedError；webhook 照读不到处理：202 ignored，
//   原因码 rate-limited（日志带 status 与重置时刻），不缓存，限流过后照判。
//   round 2（#1477 pr-gate run 1）：打标人权限类的三种拒收 202 只答
//   SENDER_REFUSED_DETAIL，细节进日志行的 detail；W15 轮询器的在飞现数含
//   webhook 正在导入的那条；W16 导入自己的 404；W17 存量 githubRepo 形坏；
//   W18 编排抛错时审计行照写。
// 出站纪律：githubFetch 注入 mock，测试面零真实出站。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Phase, type TodoSourceKind, webhookReceiverResponseSchema } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  chiefMessage as chiefMessageTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  githubConnection as githubConnectionTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
  webhookToken as webhookTokenTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/github.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { importGithubIssue, importsInFlightFor } from '../src/services/github-issues.js';
import { createIssueIntake, ISSUE_INTAKE_IN_FLIGHT_CAP } from '../src/services/issue-intake.js';
import { receiveGithubWebhook, resetWebhookDeliveryWindow } from '../src/services/webhook.js';
import { bootServer, req, type TestServer } from './helpers.js';

const GH_TOKEN = 'ghp_webhook_test_token';
const REPO = 'octo/alpha';
const ISSUE_PATH = `/repos/${REPO}/issues/7`;
const LABELS_PATH = `/repos/${REPO}/labels`;
/** 缺省打标人（webhook sender）：仓主，permission 应答 admin。 */
const SENDER = 'octo';
const permissionPath = (login: string) => `/repos/${REPO}/collaborators/${login}/permission`;
/** permission 应答形状取 GitHub OpenAPI 示例（#1406 夹具，代理拦 collaborators 路径）。 */
const PERMISSION_EXAMPLE = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'fixtures/issue-intake/permission-admin.docs-example.json'),
    'utf8',
  ),
) as { permission: string; role_name: string; user: Record<string, unknown> };

function permissionBody(
  login: string,
  permission: string,
  roleName: string,
  triage: boolean | undefined = undefined,
) {
  return {
    ...PERMISSION_EXAMPLE,
    permission,
    role_name: roleName,
    user: {
      ...PERMISSION_EXAMPLE.user,
      login,
      ...(triage !== undefined ? { permissions: { pull: true, triage, push: false } } : {}),
    },
  };
}

const ISSUE_DETAIL = {
  number: 7,
  title: 'webhook 入口测试 issue',
  body: '正文：贴 pacman 标签自动建任务。',
  state: 'open',
  labels: [{ name: 'pacman', color: '0075ca' }],
};
const LABELS_FULL = [{ name: 'pacman', color: '0075ca', description: null }];

/** labeled 事件载荷（GitHub issues webhook 原形的消费子集）。sender = 打标人
 * （缺省仓主；null = 载荷不带 sender）；author = issue 作者（issue.user）。 */
function labeledPayload(
  labelName = 'pacman',
  opts: { sender?: string | null; issue?: number; author?: string } = {},
) {
  const sender = opts.sender === undefined ? SENDER : opts.sender;
  return {
    action: 'labeled',
    issue: {
      number: opts.issue ?? 7,
      title: ISSUE_DETAIL.title,
      user: { login: opts.author ?? SENDER },
    },
    label: { name: labelName },
    repository: { full_name: REPO },
    ...(sender !== null ? { sender: { login: sender, type: 'User' } } : {}),
  };
}

function post(
  app: Hono,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

type MockRoute = {
  status?: number;
  body: unknown;
  throws?: boolean;
  headers?: Record<string, string>;
};

/** ghMock：按 pathname 分发（github-issues.test.ts 同族，此处收窄为静态路由；
 * routes 按引用持有，用例可在 boot 之后增改。throws = 网络失败 / 超时；
 * headers = 应答头（键小写）。 */
function ghMock(routes: Record<string, MockRoute>): {
  impl: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  const impl: FetchLike = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const route = routes[url.pathname];
    if (route?.throws === true) throw new TypeError('fetch failed');
    const status = route?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => route?.headers?.[name.toLowerCase()] ?? null },
      json: async () => route?.body ?? {},
      text: async () => JSON.stringify(route?.body ?? {}),
    };
  };
  return { impl, calls };
}

function defaultRoutes(overrides: Record<string, MockRoute> = {}): Record<string, MockRoute> {
  return {
    [ISSUE_PATH]: { body: ISSUE_DETAIL },
    [LABELS_PATH]: { body: LABELS_FULL },
    [permissionPath(SENDER)]: { body: permissionBody(SENDER, 'admin', 'admin') },
    ...overrides,
  };
}

async function createWebhookToken(
  app: Hono,
  teamId: string,
  name = 'hook',
): Promise<{ id: string; plaintext: string }> {
  const res = await req(app, 'POST', `/api/teams/${teamId}/webhook-tokens`, { name });
  if (res.status !== 201) throw new Error(`createWebhookToken: ${res.status}`);
  return (await res.json()) as { id: string; plaintext: string };
}

async function postGithubProject(app: Hono): Promise<string> {
  const res = await req(app, 'POST', '/api/projects', {
    name: 'alpha',
    kind: 'github',
    githubRepo: REPO,
  });
  if (res.status !== 201) throw new Error(`postGithubProject: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

let s: TestServer;
let routes: Record<string, MockRoute>;
let mock: { impl: FetchLike; calls: string[] };
let token: { id: string; plaintext: string };
let projectId: string;

beforeEach(async () => {
  // 投递去重册是模块级内存态（跨 bootServer 存续）——用例间清零隔离。
  resetWebhookDeliveryWindow();
  routes = defaultRoutes();
  mock = ghMock(routes);
  s = bootServer({ githubFetch: mock.impl });
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'octo', accessToken: GH_TOKEN, scope: 'repo' },
  );
  projectId = await postGithubProject(s.app);
  // chief 绑定 Agent（orchestrateTodo 前置；orchestration-source 同形 seed）。
  s.db
    .insert((await import('../src/db/schema.js')).agent)
    .values({
      id: 'agent-wh-1',
      teamId: s.team.id,
      displayName: 'agent-wh-1',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const chiefId = `chief-${s.user.id}-${s.team.id}`;
  s.db
    .insert((await import('../src/db/schema.js')).chief)
    .values({
      id: chiefId,
      userId: s.user.id,
      teamId: s.team.id,
      agentId: 'agent-wh-1',
      charter: '',
      watches: [],
      wakes: [],
      createdAt: Date.now(),
    })
    .run();
  token = await createWebhookToken(s.app, s.team.id);
});

afterEach(() => {
  s.dispose();
});

const DELIVERY = 'deadbeef-delivery-1';

describe('A created 全链（请求/落库/派发三段 tracer）', () => {
  test('A1/A2 触发 label → 202 created；todo + chief 派发行 + lastUsedAt 三段落值', async () => {
    const res = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    expect(res.status).toBe(202);
    const body = webhookReceiverResponseSchema.parse(await res.json());
    expect(body.result).toBe('created');
    expect(body.deliveryId).toBe(DELIVERY);
    expect(body.todoId).toBeDefined();
    expect(body.threadId?.startsWith('chief-')).toBe(true);
    // 落库段：todo 行来源两列 + token lastUsedAt。
    const todoRow = s.db.select().from(todoTable).where(eq(todoTable.id, body.todoId!)).get();
    expect(todoRow?.sourceKind).toBe('github-issue');
    expect(todoRow?.sourceRef).toBe(`github:${REPO}#7`);
    expect(todoRow?.phase).toBe('todo');
    const tokenRow = s.db
      .select()
      .from(webhookTokenTable)
      .where(eq(webhookTokenTable.id, token.id))
      .get();
    expect(tokenRow?.lastUsedAt).not.toBeNull();
    // 派发段：chief_thread + 首条 user 消息（spec 逐字内嵌）+ pending 步。
    const threadRow = s.db
      .select()
      .from(chiefThreadTable)
      .where(eq(chiefThreadTable.id, body.threadId!))
      .get();
    expect(threadRow).toBeDefined();
    const messages = s.db
      .select()
      .from(chiefMessageTable)
      .where(eq(chiefMessageTable.threadId, body.threadId!))
      .all();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toContain('正文：贴 pacman 标签自动建任务。');
    const steps = s.db.select().from(stepTable).where(eq(stepTable.buildId, body.threadId!)).all();
    expect(steps).toHaveLength(1);
    expect(steps[0]!.kind).toBe('chief');
    expect(steps[0]!.status).toBe('pending');
  });
});

describe('B 去重双层', () => {
  test('B1 同 delivery 60s 窗口二次投递 → duplicate，无双建', async () => {
    const first = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    expect(webhookReceiverResponseSchema.parse(await first.json()).result).toBe('created');
    const second = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    const body = webhookReceiverResponseSchema.parse(await second.json());
    expect(body.result).toBe('duplicate');
    expect(s.db.select().from(todoTable).all()).toHaveLength(1);
    expect(s.db.select().from(chiefThreadTable).all()).toHaveLength(1);
  });

  test('B2 同 issue 不同 delivery（重放）→ duplicate（sourceRef 持久闸）', async () => {
    await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    const replay = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': 'different-delivery-2',
    });
    const body = webhookReceiverResponseSchema.parse(await replay.json());
    expect(body.result).toBe('duplicate');
    expect(s.db.select().from(todoTable).all()).toHaveLength(1);
  });
});

describe('C ignored / noop（GitHub 重试风暴防御）', () => {
  test('C1 ping 事件 → 202 ignored，零副作用零出站', async () => {
    const res = await post(
      s.app,
      `/api/webhook/github/${token.plaintext}`,
      { zen: 'Keep it simple.' },
      {
        'x-github-event': 'ping',
        'x-github-delivery': DELIVERY,
      },
    );
    expect(res.status).toBe(202);
    const body = webhookReceiverResponseSchema.parse(await res.json());
    expect(body.result).toBe('ignored');
    expect(s.db.select().from(todoTable).all()).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });

  test('C2 未知事件（push）→ 202 ignored', async () => {
    const res = await post(
      s.app,
      `/api/webhook/github/${token.plaintext}`,
      { ref: 'refs/heads/main' },
      { 'x-github-event': 'push', 'x-github-delivery': DELIVERY },
    );
    expect(webhookReceiverResponseSchema.parse(await res.json()).result).toBe('ignored');
  });

  test('C3 非 labeled / 非触发 label → 202 ignored，零出站', async () => {
    const opened = await post(
      s.app,
      `/api/webhook/github/${token.plaintext}`,
      { action: 'opened', issue: { number: 7 }, repository: { full_name: REPO } },
      { 'x-github-event': 'issues', 'x-github-delivery': 'd-opened' },
    );
    expect(webhookReceiverResponseSchema.parse(await opened.json()).result).toBe('ignored');
    const otherLabel = await post(
      s.app,
      `/api/webhook/github/${token.plaintext}`,
      labeledPayload('bug'),
      {
        'x-github-event': 'issues',
        'x-github-delivery': 'd-other',
      },
    );
    expect(webhookReceiverResponseSchema.parse(await otherLabel.json()).result).toBe('ignored');
    expect(mock.calls).toHaveLength(0);
  });

  test('C4 载荷形坏（缺 issue.number）→ 202 ignored（不 400）', async () => {
    const res = await post(
      s.app,
      `/api/webhook/github/${token.plaintext}`,
      { action: 'labeled', repository: { full_name: REPO } },
      { 'x-github-event': 'issues', 'x-github-delivery': 'd-malformed' },
    );
    expect(res.status).toBe(202);
    expect(webhookReceiverResponseSchema.parse(await res.json()).result).toBe('ignored');
  });
});

describe('D misconfigured / 上游瞬时失败', () => {
  test('D1 repo 无映射项目 → 202 misconfigured', async () => {
    await req(s.app, 'DELETE', `/api/projects/${await postGithubProject(s.app)}`);
    // 删掉两个项目，repo 无映射
    const projects = s.db
      .select()
      .from((await import('../src/db/schema.js')).project)
      .all();
    for (const p of projects) {
      await req(s.app, 'DELETE', `/api/projects/${p.id}`);
    }
    const res = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    const body = webhookReceiverResponseSchema.parse(await res.json());
    expect(body.result).toBe('misconfigured');
    expect(mock.calls).toHaveLength(0);
  });

  test('D2 GitHub 未连接 → 202 misconfigured', async () => {
    s.db
      .delete((await import('../src/db/schema.js')).githubConnection)
      .where(eq((await import('../src/db/schema.js')).githubConnection.teamId, s.team.id))
      .run();
    const res = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    const body = webhookReceiverResponseSchema.parse(await res.json());
    expect(body.result).toBe('misconfigured');
  });

  test('D3 上游瞬时失败（issue 详情 502 族）→ 502 直透', async () => {
    const failing = ghMock(defaultRoutes({ [ISSUE_PATH]: { status: 500, body: {} } }));
    s.dispose();
    s = bootServer({ githubFetch: failing.impl });
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: GH_TOKEN, scope: 'repo' },
    );
    await postGithubProject(s.app);
    token = await createWebhookToken(s.app, s.team.id);
    const res = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    expect(res.status).toBe(502);
    // 半成品防御：无 todo 行。
    expect(s.db.select().from(todoTable).all()).toHaveLength(0);
  });
});

describe('E token 面', () => {
  test('E1 错 token → 401 {error} 同形，不写 lastUsedAt、零出站', async () => {
    const res = await post(s.app, '/api/webhook/github/pacm_wh_wrong_value', labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['error']);
    const tokenRow = s.db
      .select()
      .from(webhookTokenTable)
      .where(eq(webhookTokenTable.id, token.id))
      .get();
    expect(tokenRow?.lastUsedAt).toBeNull();
    expect(mock.calls).toHaveLength(0);
  });

  test('E2 吊销后投递 → 401', async () => {
    const del = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/webhook-tokens/${token.id}`);
    expect(del.status).toBe(204);
    const res = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    expect(res.status).toBe(401);
  });

  test('E3 token mgmt：创建一次性明文 + 列表掩码 + 删除 404/跨 team', async () => {
    const created = await createWebhookToken(s.app, s.team.id, 'second');
    expect(created.plaintext).toMatch(/^pacman_wh_[0-9a-f]{36}$/);
    const list = (await (
      await req(s.app, 'GET', `/api/teams/${s.team.id}/webhook-tokens`)
    ).json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    const raw = JSON.stringify(list);
    expect(raw).not.toContain('tokenHash');
    expect(raw).not.toContain(created.plaintext);
    expect(list.every((row) => typeof row.masked === 'string')).toBe(true);
    // 删除不存在 id → 404；再删已删 → 404。
    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/webhook-tokens/nope`)).status).toBe(
      404,
    );
    expect(
      (await req(s.app, 'DELETE', `/api/teams/${s.team.id}/webhook-tokens/${created.id}`)).status,
    ).toBe(204);
    expect(
      (await req(s.app, 'DELETE', `/api/teams/${s.team.id}/webhook-tokens/${created.id}`)).status,
    ).toBe(404);
  });

  test('E3 requireTeam 闸：错 team id → 404', async () => {
    expect((await req(s.app, 'GET', '/api/teams/other-team/webhook-tokens')).status).toBe(404);
    expect(
      (await req(s.app, 'POST', '/api/teams/other-team/webhook-tokens', { name: 'x' })).status,
    ).toBe(404);
  });
});

describe('F token-auth 豁免面（PACMAN_TOKEN 开）', () => {
  function bootAuthed(): TestServer {
    const authed = bootServer({ authToken: 'gate-token', githubFetch: mock.impl });
    upsertGithubConnection(
      { db: authed.db, box: authed.secretBox },
      { teamId: authed.team.id, login: 'octo', accessToken: GH_TOKEN, scope: 'repo' },
    );
    return authed;
  }

  test('F1 receiver 免 Bearer 可达（自有 token 闸照常：错值 401）', async () => {
    const authed = bootAuthed();
    // token mgmt 要 Bearer（F2 钉的面），这里直插行取得 receiver 凭证。
    const { createWebhookToken: createRow } = await import('../src/services/webhook-tokens.js');
    const authedToken = createRow({ db: authed.db }, { teamId: authed.team.id, name: 'authed' });
    const res = await post(
      authed.app,
      `/api/webhook/github/${authedToken.plaintext}`,
      labeledPayload(),
      {
        'x-github-event': 'ping',
        'x-github-delivery': DELIVERY,
      },
    );
    expect(res.status).toBe(202); // 穿闸达 receiver（ping = ignored）
    const wrong = await post(
      authed.app,
      '/api/webhook/github/wrong',
      {},
      {
        'x-github-event': 'ping',
      },
    );
    expect(wrong.status).toBe(401); // receiver 自有闸
    authed.dispose();
  });

  test('F2 token mgmt 端点仍要 Bearer（无凭证 401，闸形状）', async () => {
    const authed = bootAuthed();
    expect(
      (await req(authed.app, 'GET', `/api/teams/${authed.team.id}/webhook-tokens`)).status,
    ).toBe(401);
    expect(
      (await req(authed.app, 'POST', `/api/teams/${authed.team.id}/webhook-tokens`, {})).status,
    ).toBe(401);
    authed.dispose();
  });

  test('F3 /api/webhookfoo 段边界不豁免 → 401', async () => {
    const authed = bootAuthed();
    const res = await post(authed.app, '/api/webhookfoo/x', {});
    expect(res.status).toBe(401);
    authed.dispose();
  });
});

describe('服务面直达（delivery 头缺省 + logger 静默）', () => {
  test('无 delivery 头 → 不进去重册，仍正常分诊', async () => {
    const response = await receiveGithubWebhook(
      {
        db: s.db,
        hub: s.hub,
        user: s.user,
        box: s.secretBox,
        ...(mock.impl ? { githubFetch: mock.impl } : {}),
      },
      { token: token.plaintext, event: 'ping', deliveryId: undefined, body: {} },
    );
    expect(response.result).toBe('ignored');
  });
});

// #1406：webhook 与 issue 轮询器同时导入同一 issue。importGithubIssue 在第一次
// GitHub 读之前占住 sourceRef，第二路拿 409（webhook 面 = 202 duplicate），
// 只建一张卡、只编排一次。
describe('#1406 webhook 与另一路导入同一 issue 并发', () => {
  test('webhook 投递与直接导入同时进来：一张卡，后到的一路 409', async () => {
    // 详情读卡在闸门上 20ms：先占位的一路握着占位等 GitHub，另一路此时进门。
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const gated: FetchLike = async (input, init) => {
      if (new URL(String(input)).pathname === ISSUE_PATH) await gate;
      return mock.impl(input, init);
    };
    const projectRow = s.db
      .select()
      .from(projectTable)
      .where(eq(projectTable.githubRepo, REPO))
      .get();
    if (projectRow === undefined) throw new Error('project missing');
    const deps = { db: s.db, hub: s.hub, user: s.user, box: s.secretBox, githubFetch: gated };
    const hook = receiveGithubWebhook(deps, {
      token: token.plaintext,
      event: 'issues',
      deliveryId: 'race-delivery-1',
      body: labeledPayload(),
    });
    const direct = importGithubIssue(deps, projectRow, 7);
    setTimeout(open, 20);
    const [hookResult, directResult] = await Promise.allSettled([hook, direct]);
    const rows = s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.sourceRef, `github:${REPO}#7`))
      .all();
    expect(rows).toHaveLength(1);
    expect(hookResult.status).toBe('fulfilled');
    const hookBody = (hookResult as PromiseFulfilledResult<{ result: string }>).value;
    if (hookBody.result === 'created') {
      // webhook 先占位：直接导入那一路 409。
      expect(directResult.status).toBe('rejected');
      const reason = (directResult as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(HttpError);
      expect((reason as HttpError).status).toBe(409);
      expect(s.db.select().from(chiefThreadTable).all()).toHaveLength(1);
    } else {
      expect(hookBody.result).toBe('duplicate');
      expect(directResult.status).toBe('fulfilled');
      expect(s.db.select().from(chiefThreadTable).all()).toHaveLength(0);
    }
  });
});

// —— #1459 打标人按 D5 核 + 计入在飞上限 ————————————————————————————————————
// W 编号对位 docs/verify/1459/failure-modes.txt。

const REFUSED_LOG = 'github webhook import refused';
/** 打标人权限类拒收（不到 triage / 读不到 / 遇限流）对 URL token 持有人一律答这
 * 一句：哪一种、哪个账号、什么权限只进日志行（round 2：202 不当权限查询口）。 */
const SENDER_REFUSED_DETAIL = 'sender not confirmed for import (reason in the server log)';
const CAP_DETAIL = `project at the in-flight cap (${ISSUE_INTAKE_IN_FLIGHT_CAP} open github-issue tasks)`;

type LogLine = Record<string, unknown>;

/** HTTP 面投递（状态码 + 封套；非 202 时原样给 JSON）。 */
async function deliverHttp(
  body: unknown,
  deliveryId: string,
): Promise<{ status: number; body: ReturnType<typeof webhookReceiverResponseSchema.parse> }> {
  const res = await post(s.app, `/api/webhook/github/${token.plaintext}`, body, {
    'x-github-event': 'issues',
    'x-github-delivery': deliveryId,
  });
  const json: unknown = await res.json();
  return {
    status: res.status,
    body: (res.status === 202 ? webhookReceiverResponseSchema.parse(json) : json) as ReturnType<
      typeof webhookReceiverResponseSchema.parse
    >,
  };
}

/** 服务面直达（带可捕获的 pino 日志：每行解析成对象）。 */
/** 可捕获的 pino 日志（每行解析成对象）。 */
function captureLogger(): { logger: pino.Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger = pino(
    { level: 'info' },
    {
      write: (line: string) => {
        lines.push(JSON.parse(line) as LogLine);
      },
    },
  );
  return { logger, lines };
}

async function deliverDirect(body: unknown, deliveryId: string, fetchImpl: FetchLike = mock.impl) {
  const { logger, lines } = captureLogger();
  const response = await receiveGithubWebhook(
    { ...s.svc, box: s.secretBox, githubFetch: fetchImpl, logger },
    { token: token.plaintext, event: 'issues', deliveryId, body },
  );
  return { response, lines };
}

const refusals = (lines: LogLine[]) => lines.filter((l) => l.msg === REFUSED_LOG);
const permissionReads = () => mock.calls.filter((p) => p.endsWith('/permission'));
const issueReads = () => mock.calls.filter((p) => /\/issues\/\d+$/.test(p));
const issueTasks = () =>
  s.db.select().from(todoTable).where(eq(todoTable.sourceKind, 'github-issue')).all();

let taskSeq = 900;

/** 直插一张来源卡（在飞上限场景；webhook 导入的形状：createdBy = seed 用户）。 */
function insertIssueTask(
  n: number,
  phase: Phase,
  sourceKind: TodoSourceKind = 'github-issue',
): void {
  taskSeq += 1;
  s.db
    .insert(todoTable)
    .values({
      id: `todo-wh-${taskSeq}`,
      teamId: s.team.id,
      projectId,
      title: `issue ${n}`,
      spec: '',
      phase,
      phaseAt: Date.now(),
      seqNum: taskSeq,
      sourceKind,
      sourceRef: `github:${REPO}#${n}`,
      createdBy: s.user.id,
    })
    .run();
}

/** issue 详情读卡在闸门上（并发场景：先占位的一路握着占位等 GitHub）。 */
function gatedFetch(paths: string[]): { impl: FetchLike; open: () => void } {
  let open: () => void = () => {};
  const gate = new Promise<void>((r) => {
    open = r;
  });
  const impl: FetchLike = async (input, init) => {
    if (paths.includes(new URL(String(input)).pathname)) await gate;
    return mock.impl(input, init);
  };
  return { impl, open };
}

/** 轮询器看到的带 ready-for-agent 的 open issue 与它的 labeled 事件（#1406
 * events-1406.json 的形状，actor = login）。 */
function listForPoller(n: number, labeler: string): void {
  routes[`/repos/${REPO}/issues`] = {
    body: [
      {
        number: n,
        title: `issue ${n}`,
        state: 'open',
        labels: [{ name: 'ready-for-agent', color: '0E8A16' }],
        created_at: '2026-10-21T00:00:00Z',
        body: null,
      },
    ],
  };
  routes[`/repos/${REPO}/issues/${n}`] = { body: { ...ISSUE_DETAIL, number: n } };
  routes[`/repos/${REPO}/issues/${n}/events`] = {
    body: [
      {
        id: 1,
        actor: { login: labeler, id: 1, type: 'User' },
        event: 'labeled',
        commit_id: null,
        created_at: '2026-10-21T00:00:01Z',
        label: { name: 'ready-for-agent', color: '0E8A16' },
        performed_via_github_app: null,
      },
    ],
  };
}

describe('#1459 W 打标人（sender）按 D5 核', () => {
  test('W1 外部作者经 issue 模板自动打标（sender = 作者，permission 404）→ 202 ignored，不导入、不读 issue，记日志', async () => {
    routes[permissionPath('outsider')] = { status: 404, body: { message: 'Not Found' } };
    const payload = labeledPayload('pacman', { sender: 'outsider', author: 'outsider' });
    const http = await deliverHttp(payload, 'w1-http');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({
      result: 'ignored',
      deliveryId: 'w1-http',
      detail: SENDER_REFUSED_DETAIL,
    });
    expect(permissionReads()).toEqual([permissionPath('outsider')]);
    expect(issueReads()).toHaveLength(0);
    expect(issueTasks()).toHaveLength(0);
    const direct = await deliverDirect(payload, 'w1-direct');
    expect(direct.response.result).toBe('ignored');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({
        deliveryId: 'w1-direct',
        issue: 7,
        sender: 'outsider',
        reason: 'sender-below-triage',
        detail: `outsider is below triage on ${REPO}`,
      }),
    ]);
    // 404 是明确的否定答案：TTL 内不重读（与轮询器同一缓存律）。
    expect(permissionReads()).toHaveLength(1);
    expect(issueTasks()).toHaveLength(0);
  });

  test('W2 打标人只有 read（role read、triage false）→ 202 ignored，不导入', async () => {
    routes[permissionPath('reader')] = { body: permissionBody('reader', 'read', 'read', false) };
    const http = await deliverHttp(labeledPayload('pacman', { sender: 'reader' }), 'w2');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({
      result: 'ignored',
      deliveryId: 'w2',
      detail: SENDER_REFUSED_DETAIL,
    });
    // 202 只有那一句：哪种拒收由日志行的原因码钉（读到 read，不是读不到）。
    const direct = await deliverDirect(labeledPayload('pacman', { sender: 'reader' }), 'w2-direct');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ sender: 'reader', reason: 'sender-below-triage' }),
    ]);
    expect(issueReads()).toHaveLength(0);
    expect(issueTasks()).toHaveLength(0);
  });

  test.each([
    ['triage', permissionBody('labeler', 'read', 'triage')],
    ['write', permissionBody('labeler', 'write', 'write')],
    ['maintain', permissionBody('labeler', 'write', 'maintain')],
    ['admin', permissionBody('labeler', 'admin', 'admin')],
    ['custom role built on triage', permissionBody('labeler', 'read', 'issue-wrangler', true)],
  ])('W3 打标人 %s → 202 created（先读 permission 再导入）', async (_role, body) => {
    routes[permissionPath('labeler')] = { body };
    const http = await deliverHttp(labeledPayload('pacman', { sender: 'labeler' }), 'w3');
    expect(http.status).toBe(202);
    expect(http.body.result).toBe('created');
    expect(issueTasks()).toHaveLength(1);
    expect(permissionReads()).toEqual([permissionPath('labeler')]);
    expect(mock.calls.indexOf(permissionPath('labeler'))).toBeLessThan(
      mock.calls.indexOf(ISSUE_PATH),
    );
  });

  test.each([
    ['403', { status: 403, body: { message: 'Forbidden' } }],
    ['500', { status: 500, body: {} }],
    ['502', { status: 502, body: {} }],
    ['network error / timeout', { body: null, throws: true }],
    ['malformed 200 body', { body: { role_name: 'admin' } }],
  ] satisfies Array<[string, MockRoute]>)(
    'W4 permission 读失败（%s）→ 202 ignored，不导入，记日志，不缓存',
    async (_case, route) => {
      routes[permissionPath(SENDER)] = route;
      const http = await deliverHttp(labeledPayload(), 'w4-http');
      expect(http.status).toBe(202);
      expect(http.body).toEqual({
        result: 'ignored',
        deliveryId: 'w4-http',
        detail: SENDER_REFUSED_DETAIL,
      });
      const direct = await deliverDirect(labeledPayload(), 'w4-direct');
      expect(direct.response.result).toBe('ignored');
      expect(refusals(direct.lines)).toEqual([
        expect.objectContaining({
          sender: SENDER,
          reason: 'permission-unreadable',
          detail: `permission of ${SENDER} on ${REPO} unreadable`,
        }),
      ]);
      // 读不到不进缓存：第二次投递重读。
      expect(permissionReads()).toHaveLength(2);
      expect(issueReads()).toHaveLength(0);
      expect(issueTasks()).toHaveLength(0);
    },
  );

  const RESET_AT = new Date(1_800_000_600_000).toISOString();
  test.each([
    ['429 without headers', { status: 429, body: { message: 'API rate limit exceeded' } }, null],
    [
      '429 with retry-after 60',
      {
        status: 429,
        headers: { 'retry-after': '60' },
        body: { message: 'API rate limit exceeded' },
      },
      'retry-after',
    ],
    [
      '403 with x-ratelimit-remaining 0 and x-ratelimit-reset',
      {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000600' },
        body: { message: 'API rate limit exceeded for user ID 1.' },
      },
      RESET_AT,
    ],
    [
      '403 secondary limit, message only',
      {
        status: 403,
        body: {
          message:
            'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
        },
      },
      null,
    ],
  ] satisfies Array<[string, MockRoute, string | null]>)(
    'W4b permission 读遇限流（%s）→ 202 ignored rate-limited，不导入，记日志带重置时刻，不缓存，限流过后照判',
    async (_case, route, reset) => {
      routes[permissionPath(SENDER)] = route;
      const http = await deliverHttp(labeledPayload(), 'w4b-http');
      expect(http.status).toBe(202);
      expect(http.body).toEqual({
        result: 'ignored',
        deliveryId: 'w4b-http',
        detail: SENDER_REFUSED_DETAIL,
      });
      const direct = await deliverDirect(labeledPayload(), 'w4b-direct');
      expect(direct.response).toEqual({
        result: 'ignored',
        deliveryId: 'w4b-direct',
        detail: SENDER_REFUSED_DETAIL,
      });
      // 限流的细节（状态码、重置时刻）只进日志行。
      const prefix = `github rate limited reading the permission of ${SENDER} on ${REPO}`;
      const [line] = refusals(direct.lines);
      expect(refusals(direct.lines)).toEqual([
        expect.objectContaining({
          deliveryId: 'w4b-direct',
          sender: SENDER,
          reason: 'rate-limited',
          status: route.status,
          resetAt: reset === null ? null : reset === 'retry-after' ? expect.any(String) : reset,
        }),
      ]);
      if (reset === null) expect(line?.detail).toBe(prefix);
      else if (reset === 'retry-after') {
        expect(line?.detail).toMatch(
          new RegExp(`^${prefix} \\(resets at \\d{4}-\\d\\d-\\d\\dT[^)]+Z\\)$`),
        );
      } else expect(line?.detail).toBe(`${prefix} (resets at ${reset})`);
      // 限流不进缓存：第二次投递重读；没读 issue、没建卡。
      expect(permissionReads()).toHaveLength(2);
      expect(issueReads()).toHaveLength(0);
      expect(issueTasks()).toHaveLength(0);
      // 限流过后（新投递）照判：读到 admin → 导入。
      routes[permissionPath(SENDER)] = { body: permissionBody(SENDER, 'admin', 'admin') };
      const after = await deliverHttp(labeledPayload(), 'w4b-after');
      expect(after.body.result).toBe('created');
      expect(permissionReads()).toHaveLength(3);
      expect(issueTasks()).toHaveLength(1);
    },
  );

  test('W5a 团队没有 GitHub 连接 → 202 misconfigured，零出站（不匿名读），记日志', async () => {
    s.db.delete(githubConnectionTable).where(eq(githubConnectionTable.teamId, s.team.id)).run();
    const http = await deliverHttp(labeledPayload(), 'w5a');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({
      result: 'misconfigured',
      deliveryId: 'w5a',
      detail: 'github connection not found',
    });
    const direct = await deliverDirect(labeledPayload(), 'w5a-direct');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ reason: 'no-github-connection' }),
    ]);
    expect(mock.calls).toHaveLength(0);
    expect(issueTasks()).toHaveLength(0);
  });

  test('W5b 连接 token 解不开（密文坏）→ 202 misconfigured（不是 500），零出站，记日志', async () => {
    s.db
      .update(githubConnectionTable)
      .set({ accessTokenCipher: 'not-a-sealed-token' })
      .where(eq(githubConnectionTable.teamId, s.team.id))
      .run();
    const http = await deliverHttp(labeledPayload(), 'w5b');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({
      result: 'misconfigured',
      deliveryId: 'w5b',
      detail: 'github token unreadable',
    });
    const direct = await deliverDirect(labeledPayload(), 'w5b-direct');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ reason: 'token-unreadable' }),
    ]);
    expect(mock.calls).toHaveLength(0);
    expect(issueTasks()).toHaveLength(0);
  });

  test('W12a 载荷不带 sender → 202 ignored，零出站，记日志', async () => {
    const payload = labeledPayload('pacman', { sender: null });
    const http = await deliverHttp(payload, 'w12a');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({
      result: 'ignored',
      deliveryId: 'w12a',
      detail: 'event has no sender',
    });
    const direct = await deliverDirect(payload, 'w12a-direct');
    expect(refusals(direct.lines)).toEqual([expect.objectContaining({ reason: 'no-sender' })]);
    expect(mock.calls).toHaveLength(0);
    expect(issueTasks()).toHaveLength(0);
  });

  test('W12b sender 是 ghost（GitHub 认不出人时的占位账号，permission 404）→ 202 ignored', async () => {
    routes[permissionPath('ghost')] = { status: 404, body: { message: 'Not Found' } };
    const http = await deliverHttp(labeledPayload('pacman', { sender: 'ghost' }), 'w12b');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({
      result: 'ignored',
      deliveryId: 'w12b',
      detail: SENDER_REFUSED_DETAIL,
    });
    // 404 是明确的否定答案：原因码是不到 triage，不是读不到。
    const direct = await deliverDirect(
      labeledPayload('pacman', { sender: 'ghost' }),
      'w12b-direct',
    );
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ sender: 'ghost', reason: 'sender-below-triage' }),
    ]);
    expect(issueTasks()).toHaveLength(0);
  });

  test('W13 webhook 导入的卡 createdBy 仍是 seed 用户（轮询器的关闭对账不碰）', async () => {
    const http = await deliverHttp(labeledPayload(), 'w13');
    expect(http.body.result).toBe('created');
    const row = s.db.select().from(todoTable).where(eq(todoTable.id, http.body.todoId!)).get();
    expect(row?.createdBy).toBe(s.user.id);
  });

  test('W14a 同一 sender 两次投递（不同 issue）：permission 只读一次（与轮询器同一缓存）', async () => {
    routes[`/repos/${REPO}/issues/8`] = { body: { ...ISSUE_DETAIL, number: 8 } };
    const first = await deliverHttp(labeledPayload('pacman', { issue: 7 }), 'w14a-1');
    const second = await deliverHttp(labeledPayload('pacman', { issue: 8 }), 'w14a-2');
    expect([first.body.result, second.body.result]).toEqual(['created', 'created']);
    expect(permissionReads()).toEqual([permissionPath(SENDER)]);
  });

  test('W14b webhook 读到的答案轮询器直接用：轮询器领同一打标人的 issue 不再读 permission', async () => {
    const hook = await deliverHttp(labeledPayload(), 'w14b');
    expect(hook.body.result).toBe('created');
    expect(permissionReads()).toEqual([permissionPath(SENDER)]);
    listForPoller(8, SENDER);
    const intake = createIssueIntake({ ...s.svc, box: s.secretBox }, { githubFetch: mock.impl });
    const tally = await intake.sweep();
    expect(tally?.imported).toBe(1);
    expect(issueTasks().map((t) => t.sourceRef)).toEqual([`github:${REPO}#7`, `github:${REPO}#8`]);
    expect(permissionReads()).toEqual([permissionPath(SENDER)]);
  });
});

describe('#1459 W 计入在飞上限', () => {
  test('W6 项目到上限（todo / building / failed 三张）→ 202 ignored，零出站，记日志', async () => {
    insertIssueTask(101, 'todo');
    insertIssueTask(102, 'building');
    insertIssueTask(103, 'failed');
    const http = await deliverHttp(labeledPayload(), 'w6');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({ result: 'ignored', deliveryId: 'w6', detail: CAP_DETAIL });
    const direct = await deliverDirect(labeledPayload(), 'w6-direct');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ issue: 7, reason: 'at-cap' }),
    ]);
    expect(mock.calls).toHaveLength(0);
    expect(issueTasks()).toHaveLength(ISSUE_INTAKE_IN_FLIGHT_CAP);
  });

  test('W6b done / closed 的卡与自建 issue 卡不计入 → 202 created', async () => {
    insertIssueTask(101, 'done');
    insertIssueTask(102, 'closed');
    insertIssueTask(103, 'building', 'github-issue-self');
    const http = await deliverHttp(labeledPayload(), 'w6b');
    expect(http.body.result).toBe('created');
  });

  test('W8 差一位到上限时两条投递同时到（批量打标）→ 只导入一条，另一条 202 ignored 到上限', async () => {
    insertIssueTask(101, 'todo');
    insertIssueTask(102, 'building');
    routes[`/repos/${REPO}/issues/8`] = { body: { ...ISSUE_DETAIL, number: 8 } };
    const gated = gatedFetch([ISSUE_PATH, `/repos/${REPO}/issues/8`]);
    const a = deliverDirect(labeledPayload('pacman', { issue: 7 }), 'w8-a', gated.impl);
    const b = deliverDirect(labeledPayload('pacman', { issue: 8 }), 'w8-b', gated.impl);
    setTimeout(gated.open, 30);
    const results = await Promise.all([a, b]);
    expect(results.map((r) => r.response.result).sort()).toEqual(['created', 'ignored']);
    const refused = results.find((r) => r.response.result === 'ignored');
    expect(refused?.response.detail).toBe(CAP_DETAIL);
    expect(refusals(refused?.lines ?? [])).toEqual([expect.objectContaining({ reason: 'at-cap' })]);
    expect(issueTasks()).toHaveLength(ISSUE_INTAKE_IN_FLIGHT_CAP);
  });
});

describe('#1459 W 并发与重投', () => {
  test('W7 webhook 与轮询器同时导入同一 issue → 一张卡（另一路 409）', async () => {
    listForPoller(7, SENDER);
    const gated = gatedFetch([ISSUE_PATH]);
    const intake = createIssueIntake({ ...s.svc, box: s.secretBox }, { githubFetch: gated.impl });
    const hook = deliverDirect(labeledPayload(), 'w7', gated.impl);
    const sweep = intake.sweep();
    setTimeout(gated.open, 30);
    const [hookResult, tally] = await Promise.all([hook, sweep]);
    expect(issueTasks()).toHaveLength(1);
    expect(['created', 'duplicate']).toContain(hookResult.response.result);
    const webhookImported = hookResult.response.result === 'created' ? 1 : 0;
    expect((tally?.imported ?? 0) + webhookImported).toBe(1);
    expect(s.db.select().from(chiefThreadTable).all()).toHaveLength(1);
  });

  test('W9 被拒的投递重投（同 X-GitHub-Delivery）：窗口内 202 duplicate，窗口外照判 202 ignored，始终不导入', async () => {
    routes[permissionPath('outsider')] = { status: 404, body: { message: 'Not Found' } };
    const payload = labeledPayload('pacman', { sender: 'outsider', author: 'outsider' });
    const first = await deliverHttp(payload, 'w9');
    expect(first.status).toBe(202);
    expect(first.body.result).toBe('ignored');
    const inWindow = await deliverHttp(payload, 'w9');
    expect(inWindow.status).toBe(202);
    expect(inWindow.body.result).toBe('duplicate');
    // GitHub 的 Redeliver 沿用原 delivery id；窗口过后重新判定。
    resetWebhookDeliveryWindow();
    const later = await deliverHttp(payload, 'w9');
    expect(later.status).toBe(202);
    expect(later.body).toEqual(first.body);
    expect(issueTasks()).toHaveLength(0);
  });
});

// —— #1459 round 2（pr-gate run 1 on #1477）————————————————————————————————

describe('#1459 round 2 W 存量 githubRepo 形坏', () => {
  test.each([
    ['../user', '~proj-dotdot-owner'],
    ['owner/..', '~proj-dotdot-repo'],
  ])(
    'W17 项目存的 githubRepo 是 %s（含 . / .. 段）→ 202 misconfigured，零出站，不进权限缓存，记日志',
    async (githubRepo, id) => {
      // 直插（REST 面会拒的存量形状：#1466 之前建的行）。
      s.db
        .insert(projectTable)
        .values({ id, name: id, teamId: s.team.id, repoKind: 'github', githubRepo })
        .run();
      const payload = { ...labeledPayload(), repository: { full_name: githubRepo } };
      const http = await deliverHttp(payload, `w17-http-${id}`);
      expect(http.status).toBe(202);
      expect(http.body.result).toBe('misconfigured');
      const direct = await deliverDirect(payload, `w17-direct-${id}`);
      expect(direct.response.result).toBe('misconfigured');
      expect(refusals(direct.lines)).toEqual([
        expect.objectContaining({ projectId: id, reason: 'malformed-repo' }),
      ]);
      // 团队 token 不出站到改写过的路径；也没有权限读进缓存。
      expect(mock.calls).toEqual([]);
      expect(issueTasks()).toHaveLength(0);
    },
  );
});

describe('#1459 round 2 W 审计行', () => {
  test('W18 导入成功后编排抛错（总管没绑 Agent，409）→ 卡已建，「import accepted」审计行照写', async () => {
    s.db.update(chiefTable).set({ agentId: null }).where(eq(chiefTable.teamId, s.team.id)).run();
    const { logger, lines } = captureLogger();
    const run = receiveGithubWebhook(
      { ...s.svc, box: s.secretBox, githubFetch: mock.impl, logger },
      { token: token.plaintext, event: 'issues', deliveryId: 'w18', body: labeledPayload() },
    );
    await expect(run).rejects.toMatchObject({ status: 409 });
    const tasks = issueTasks();
    expect(tasks).toHaveLength(1);
    expect(lines.filter((l) => l.msg === 'github webhook import accepted')).toEqual([
      expect.objectContaining({ deliveryId: 'w18', todoId: tasks[0]?.id, sender: SENDER }),
    ]);
  });
});

describe('#1459 round 2 W 在飞现数与导入的 404', () => {
  test('W15 webhook 的导入还在等 GitHub 时轮询器扫一轮：差一位到上限，轮询器把那条在飞的算进去，不读列表、不领', async () => {
    insertIssueTask(101, 'todo');
    insertIssueTask(102, 'building');
    listForPoller(8, SENDER);
    const gated = gatedFetch([ISSUE_PATH]);
    const hook = deliverDirect(labeledPayload(), 'w15', gated.impl);
    // webhook 已落导入占位、卡在 #7 的详情读上。
    await vi.waitFor(() => expect(importsInFlightFor(projectId)).toBe(1));
    const intake = createIssueIntake({ ...s.svc, box: s.secretBox }, { githubFetch: mock.impl });
    const tally = await intake.sweep();
    expect(tally?.imported).toBe(0);
    expect(mock.calls.filter((p) => p === `/repos/${REPO}/issues`)).toHaveLength(0);
    gated.open();
    const hookResult = await hook;
    expect(hookResult.response.result).toBe('created');
    expect(
      issueTasks()
        .map((t) => t.sourceRef)
        .sort(),
    ).toEqual([`github:${REPO}#101`, `github:${REPO}#102`, `github:${REPO}#7`].sort());
  });

  test('W16 权限读的 await 期间团队的 GitHub 连接被删 → 导入自己的 404 收成 202 misconfigured，不建卡', async () => {
    const dropping: FetchLike = async (input, init) => {
      if (new URL(String(input)).pathname === permissionPath(SENDER)) {
        s.db.delete(githubConnectionTable).where(eq(githubConnectionTable.teamId, s.team.id)).run();
      }
      return mock.impl(input, init);
    };
    const direct = await deliverDirect(labeledPayload(), 'w16', dropping);
    expect(direct.response).toEqual({
      result: 'misconfigured',
      deliveryId: 'w16',
      detail: 'github connection not found',
    });
    expect(permissionReads()).toEqual([permissionPath(SENDER)]);
    expect(issueReads()).toHaveLength(0);
    expect(issueTasks()).toHaveLength(0);
  });
});

describe('#1459 round 2 W review 发现', () => {
  test('W19 导入时 GitHub 说 issue 不存在（详情读 404，连接还在）→ 202 misconfigured 说 issue 读不到，不说连接没了，记日志', async () => {
    routes[ISSUE_PATH] = { status: 404, body: { message: 'Not Found' } };
    const direct = await deliverDirect(labeledPayload(), 'w19');
    expect(direct.response).toEqual({
      result: 'misconfigured',
      deliveryId: 'w19',
      detail: `issue ${REPO}#7 not found on GitHub (or not visible to the team token)`,
    });
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ deliveryId: 'w19', issue: 7, reason: 'issue-not-found' }),
    ]);
    expect(issueTasks()).toHaveLength(0);
  });

  test.each([
    ['..'],
    ['.'],
    ['a/b'],
    [''],
    ['alice.acme'],
    ['_alice'],
    ['-alice'],
    ['alice_'],
    // 至多 39 个字符（EMU 的含下划线与短码）：40 个的一律拒。
    ['a'.repeat(40)],
    [`${'a'.repeat(31)}_abcdefgh`],
    [`${'a'.repeat(40)}[bot]`],
  ])('W20 sender 的 login 不是 GitHub 账号名（%j）→ 202 ignored，零出站，记日志', async (login) => {
    const payload = { ...labeledPayload(), sender: { login, type: 'User' } };
    const direct = await deliverDirect(payload, 'w20');
    expect(direct.response.result).toBe('ignored');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ reason: login === '' ? 'no-sender' : 'sender-malformed' }),
    ]);
    // 团队 token 不出站（`..` 会把权限读改写成别的路径）。
    expect(mock.calls).toEqual([]);
    expect(issueTasks()).toHaveLength(0);
  });

  test('W20b bot 账号（login 带 [bot]）照常读权限', async () => {
    // 路径里的方括号经 encodeURIComponent 编码。
    routes[`/repos/${REPO}/collaborators/octo-helper%5Bbot%5D/permission`] = {
      status: 404,
      body: { message: 'Not Found' },
    };
    const payload = { ...labeledPayload(), sender: { login: 'octo-helper[bot]', type: 'Bot' } };
    const direct = await deliverDirect(payload, 'w20b');
    expect(direct.response.result).toBe('ignored');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ reason: 'sender-below-triage' }),
    ]);
    expect(permissionReads()).toHaveLength(1);
  });

  // GitHub 文档（Enterprise Managed Users 的用户名）：GitHub.com 上托管账号的用户名
  // 是 IDP-USERNAME_SHORT-CODE（例 mona-cat_octo），开通 SAML 的设置账号是
  // SHORT-CODE_admin。这些人照轮询器的判据读权限（#1496 pr-gate 建议 1 / 9）。
  test.each([
    ['alice_acme', 'User'],
    ['mona-cat_octo', 'User'],
    ['octo_admin', 'User'],
    // 正好 39 个字符（含下划线与八位短码）。
    [`${'a'.repeat(30)}_abcdefgh`, 'User'],
    ['octo-builder[bot]', 'Bot'],
  ])(
    'W21 GitHub 认的账号名（%s：EMU 托管账号带下划线与短码、bot 带 [bot]）→ 读权限，够 triage 就导入',
    async (login, type) => {
      routes[`/repos/${REPO}/collaborators/${encodeURIComponent(login)}/permission`] = {
        body: permissionBody(login, 'admin', 'admin'),
      };
      const payload = { ...labeledPayload(), sender: { login, type } };
      const direct = await deliverDirect(payload, 'w21');
      expect(direct.response.result).toBe('created');
      expect(refusals(direct.lines)).toEqual([]);
      expect(permissionReads()).toHaveLength(1);
      expect(issueTasks()).toHaveLength(1);
    },
  );
});

describe('#1459 round 3 W 日志里的 sender', () => {
  test('W22 sender-malformed 的 sender 很长（载荷里没有长度上限）→ 日志行只记前 64 个字符与总长', async () => {
    const login = `${'.'.repeat(1000)}/x`;
    const payload = { ...labeledPayload(), sender: { login, type: 'User' } };
    const direct = await deliverDirect(payload, 'w22');
    expect(direct.response.result).toBe('ignored');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({
        reason: 'sender-malformed',
        sender: login.slice(0, 64),
        senderLength: login.length,
      }),
    ]);
    expect(mock.calls).toEqual([]);
  });
});
