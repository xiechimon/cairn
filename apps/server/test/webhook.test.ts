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
//  D2 GitHub 未连接 → 202 misconfigured（importGithubIssue 404 收敛）；
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
// 出站纪律：githubFetch 注入 mock，测试面零真实出站。

import { webhookReceiverResponseSchema } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  chiefMessage as chiefMessageTable,
  chiefThread as chiefThreadTable,
  step as stepTable,
  todo as todoTable,
  webhookToken as webhookTokenTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { receiveGithubWebhook, resetWebhookDeliveryWindow } from '../src/services/webhook.js';
import { bootServer, req, type TestServer } from './helpers.js';

const GH_TOKEN = 'ghp_webhook_test_token';
const REPO = 'octo/alpha';
const ISSUE_PATH = `/repos/${REPO}/issues/7`;
const LABELS_PATH = `/repos/${REPO}/labels`;

const ISSUE_DETAIL = {
  number: 7,
  title: 'webhook 入口测试 issue',
  body: '正文：贴 pacman 标签自动建任务。',
  state: 'open',
  labels: [{ name: 'pacman', color: '0075ca' }],
};
const LABELS_FULL = [{ name: 'pacman', color: '0075ca', description: null }];

/** labeled 事件载荷（GitHub issues webhook 原形的消费子集）。 */
function labeledPayload(labelName = 'pacman') {
  return {
    action: 'labeled',
    issue: { number: 7, title: ISSUE_DETAIL.title },
    label: { name: labelName },
    repository: { full_name: REPO },
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

/** ghMock：按 pathname 分发（github-issues.test.ts 同族，此处收窄为静态路由）。 */
function ghMock(routes: Record<string, { status?: number; body: unknown }>): {
  impl: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  const impl: FetchLike = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const route = routes[url.pathname];
    const status = route?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => route?.body ?? {},
      text: async () => JSON.stringify(route?.body ?? {}),
    };
  };
  return { impl, calls };
}

function defaultRoutes(overrides: Record<string, { status?: number; body: unknown }> = {}) {
  return {
    [ISSUE_PATH]: { body: ISSUE_DETAIL },
    [LABELS_PATH]: { body: LABELS_FULL },
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
let mock: { impl: FetchLike; calls: string[] };
let token: { id: string; plaintext: string };

beforeEach(async () => {
  // 投递去重册是模块级内存态（跨 bootServer 存续）——用例间清零隔离。
  resetWebhookDeliveryWindow();
  mock = ghMock(defaultRoutes());
  s = bootServer({ githubFetch: mock.impl });
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'octo', accessToken: GH_TOKEN, scope: 'repo' },
  );
  await postGithubProject(s.app);
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
