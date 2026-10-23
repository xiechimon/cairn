// spec 12 / #361 G2-T4：GitHub 连接认证面——OAuth web flow 的
// github-connection 族（state 判别联合区分 #231 provider 族）+ 认证状态
// 读面（login/scope，无 token 位）+ 断开。callback 复用 GET /api/oauth/
// callback 路由，按 state 族分支落点：connection 族落 /app/project/new
// （?oauth=…&github=connection，picker 打开信号），provider 族落点不变。
// scope = read:user repo（票面「加 repo scope」：picker 要读私仓列表；
// read:user 供 GET /user 取 login）。失败方式先于实现枚举（仓测试纪律）：
//  1. authorize：oauth 未配置 → 400（not-configured 族沿用，message 含 env 槽名）
//  2. authorize happy → 200 {authorizationUrl}：GitHub authorize 端点 +
//     client_id / redirect_uri / scope / state 四参齐，state 入册
//  3. GET connection：未连接 → {connected:false}；已连接 → {connected:true,
//     login,scope}（02 §8：封套无 token/密文位）；未知 team → 404
//  4. callback happy（mock token 端点 + GET /user）→ 302 <origin>/app/project/
//     new?oauth=connected&github=connection；github_connection 行建立、
//     openGithubToken 解出 mock token；落库 scope = 上游 granted 面；
//     token 仅进 Authorization 头不进 URL
//  5. callback：交换成功但 GET /user 失败 → 302 reason=exchange（归
//     exchange-failed 族，#243 三译词汇表不扩）
//  6. callback：用户拒绝（?error=access_denied 无 code）→ 302 <origin>/app/
//     project/new?oauth=error&reason=denied&github=connection；state 核销；
//     不打 token 端点
//  7. callback：connection state 过期（>30min TTL）→ 302 <origin>/app/project/
//     new?oauth=error&reason=state&github=connection
//  8. callback：state 不在册（kind 不可判）→ 302 相对 /app/resources/
//     providers?oauth=error&reason=state（默认落点 = #243 既有行为不变）
//  9. provider 族回归：provider state 仍走 provider 完成式落 providers 页
//     （state 判别联合两族不串线）
// 10. 重认证 = 覆盖：二次 happy（新 token/新 login）→ 单行、新值生效
// 11. DELETE connection：有行 → 204 + status 回 connected:false +
//     openGithubToken null；无行 → 204 幂等；未知 team → 404
// 12. token 永不进 wire：status 响应 JSON 与全部 302 Location 不含 token 明文

import { describe, expect, test } from 'vitest';
import type { AppContext } from '../src/context.js';
import type { FetchLike } from '../src/lib/github.js';
import { openGithubToken } from '../src/services/github-connection.js';
import { bootServer, req, type TestServer } from './helpers.js';

const TOKEN = 'ghu_connection_token_value';
const SECOND_TOKEN = 'ghu_second_connection_token';
const CLIENT = { clientId: 'cid-test', clientSecret: 'cs-test' };
const ORIGIN = 'http://127.0.0.1:8787';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';

interface UpstreamScript {
  token?: { status?: number; json?: unknown };
  user?: { status?: number; json?: unknown };
  /** 前缀命中 = fetch throw（网络断剧本）。 */
  throwUrls?: string[];
}

/** GitHub 上游 mock（ctx.oauthFetch 注入位——connection 族的交换与 GET /user
 * 同走 services/oauth.ts 的 deps.fetch 单点）：按 URL 路由剧本、记调用面。 */
function mockUpstream(script: UpstreamScript) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      headers: { ...(init?.headers ?? {}) },
      body: init?.body ?? '',
    });
    if (script.throwUrls?.some((prefix) => url.startsWith(prefix))) {
      throw new Error('network down');
    }
    const entry = url.startsWith(TOKEN_URL) ? script.token : script.user;
    const status = entry?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => entry?.json,
      text: async () => JSON.stringify(entry?.json ?? null),
    };
  };
  return { calls, fetchImpl };
}

const HAPPY: UpstreamScript = {
  token: { json: { access_token: TOKEN, scope: 'read:user,repo', token_type: 'bearer' } },
  user: { json: { login: 'octocat', id: 1 } },
};

function boot(script: UpstreamScript, opts: { client?: AppContext['oauthClient'] } = {}) {
  const mock = mockUpstream(script);
  const s = bootServer({
    oauthClient: opts.client === undefined ? CLIENT : opts.client,
    oauthFetch: mock.fetchImpl as AppContext['oauthFetch'],
  });
  return { s, mock };
}

/** connection 族 authorize → 从 authorizationUrl 提 state（黑盒同 oauth.test.ts）。 */
async function authorizeConnection(s: TestServer) {
  const res = await s.app.request(`/api/teams/${s.team.id}/github/oauth/authorize`, {
    method: 'POST',
    headers: { origin: ORIGIN },
  });
  const body = (await res.json()) as { authorizationUrl?: string; error?: string };
  const url = body.authorizationUrl ? new URL(body.authorizationUrl) : null;
  return { res, body, url, state: url?.searchParams.get('state') ?? null };
}

function callback(s: TestServer, query: string) {
  return s.app.request(`/api/oauth/callback?${query}`, { redirect: 'manual' });
}

function ageState(s: TestServer, state: string | null, minutesAgo: number) {
  if (state === null) throw new Error('state missing');
  const entry = s.oauthStates.get(state);
  if (!entry) throw new Error('state missing');
  entry.createdAt -= minutesAgo * 60 * 1000;
}

function statusOf(s: TestServer) {
  return req(s.app, 'GET', `/api/teams/${s.team.id}/github/connection`);
}

describe('POST /api/teams/:id/github/oauth/authorize（connection 族签发）', () => {
  test('1. oauth 未配置 → 400（not-configured 族沿用，env 槽名在 message）', async () => {
    const { s } = boot(HAPPY, { client: null });
    try {
      const { res, body } = await authorizeConnection(s);
      expect(res.status).toBe(400);
      expect(body.error).toContain('CAIRN_GITHUB_OAUTH_CLIENT_ID');
    } finally {
      s.dispose();
    }
  });

  test('2. happy：授权 URL 四参齐（scope = read:user repo）+ state 入册', async () => {
    const { s } = boot(HAPPY);
    try {
      const { res, url, state } = await authorizeConnection(s);
      expect(res.status).toBe(200);
      if (!url) throw new Error('authorizationUrl missing');
      expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe(CLIENT.clientId);
      expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/oauth/callback`);
      expect(url.searchParams.get('scope')).toBe('read:user repo');
      expect(state).toBeTruthy();
      expect(s.oauthStates.has(state as string)).toBe(true);
    } finally {
      s.dispose();
    }
  });
});

describe('GET /api/teams/:id/github/connection（认证状态读面）', () => {
  test('3a. 未连接 → {connected:false}，无 login/scope 位', async () => {
    const { s } = boot(HAPPY);
    try {
      const res = await statusOf(s);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ connected: false });
    } finally {
      s.dispose();
    }
  });

  test('3b. 已连接 → {connected:true,login,scope}；未知 team → 404', async () => {
    const { s } = boot(HAPPY);
    try {
      const { state } = await authorizeConnection(s);
      await callback(s, `code=c&state=${state}`);
      const res = await statusOf(s);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ connected: true, login: 'octocat', scope: 'read:user,repo' });
      const unknown = await req(s.app, 'GET', '/api/teams/nope/github/connection');
      expect(unknown.status).toBe(404);
    } finally {
      s.dispose();
    }
  });
});

describe('GET /api/oauth/callback（github-connection 族分支）', () => {
  test('4. happy 全链：302 落新建项目页 + 行建立 + granted scope 落库 + token 仅进头', async () => {
    const { s, mock } = boot(HAPPY);
    try {
      const { state } = await authorizeConnection(s);
      const res = await callback(s, `code=mockcode&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/app/project/new?oauth=connected&github=connection`,
      );
      // 交换打向 token 端点（带 code + client 对），再 GET /user 取 login
      const tokenCall = mock.calls.find((c) => c.url === TOKEN_URL);
      expect(tokenCall?.body).toContain('code=mockcode');
      expect(tokenCall?.body).toContain(`client_id=${CLIENT.clientId}`);
      const userCall = mock.calls.find((c) => c.url === USER_URL);
      expect(userCall?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(userCall?.url).not.toContain(TOKEN);
      // 行建立：token 可解、login/scope 落库（granted 面 = 上游应答原样）
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(TOKEN);
      const status = (await (await statusOf(s)).json()) as Record<string, unknown>;
      expect(status.login).toBe('octocat');
      expect(status.scope).toBe('read:user,repo');
    } finally {
      s.dispose();
    }
  });

  test('5. 交换成功但 GET /user 失败 → 302 reason=exchange', async () => {
    const { s } = boot({ ...HAPPY, user: { status: 500, json: { message: 'boom' } } });
    try {
      const { state } = await authorizeConnection(s);
      const res = await callback(s, `code=c&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/app/project/new?oauth=error&reason=exchange&github=connection`,
      );
    } finally {
      s.dispose();
    }
  });

  test('6. 用户拒绝 → 302 reason=denied&github=connection + state 核销 + 不打 token 端点', async () => {
    const { s, mock } = boot(HAPPY);
    try {
      const { state } = await authorizeConnection(s);
      const res = await callback(s, `error=access_denied&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/app/project/new?oauth=error&reason=denied&github=connection`,
      );
      expect(s.oauthStates.has(state as string)).toBe(false);
      expect(mock.calls).toHaveLength(0);
    } finally {
      s.dispose();
    }
  });

  test('7. connection state 过期 → 302 reason=state&github=connection', async () => {
    const { s } = boot(HAPPY);
    try {
      const { state } = await authorizeConnection(s);
      ageState(s, state, 31);
      const res = await callback(s, `code=c&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/app/project/new?oauth=error&reason=state&github=connection`,
      );
    } finally {
      s.dispose();
    }
  });

  test('8. state 不在册（kind 不可判）→ 302 相对落 providers 页（既有默认不变）', async () => {
    const { s } = boot(HAPPY);
    try {
      const res = await callback(s, 'code=c&state=bogus');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/app/resources/providers?oauth=error&reason=state');
    } finally {
      s.dispose();
    }
  });

  test('9. provider 族回归：provider state 仍落 providers 页（两族不串线）', async () => {
    const { s } = boot(HAPPY);
    try {
      const res = await s.app.request(
        `/api/teams/${s.team.id}/providers/oauth/github-copilot/authorize`,
        { method: 'POST', headers: { origin: ORIGIN } },
      );
      const body = (await res.json()) as { authorizationUrl: string };
      const state = new URL(body.authorizationUrl).searchParams.get('state');
      const landed = await callback(s, `code=c&state=${state}`);
      expect(landed.status).toBe(302);
      expect(landed.headers.get('location')).toBe(
        `${ORIGIN}/app/resources/providers?oauth=connected&provider=github-copilot`,
      );
      // connection 行不被 provider 族建立
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBeNull();
    } finally {
      s.dispose();
    }
  });

  test('10. 重认证 = 覆盖：二次 happy 新 token/login → 单行新值生效', async () => {
    const script: UpstreamScript = {
      token: { json: { access_token: TOKEN, scope: 'read:user,repo' } },
      user: { json: { login: 'octocat' } },
    };
    const { s } = boot(script);
    try {
      const a1 = await authorizeConnection(s);
      await callback(s, `code=c1&state=${a1.state}`);
      script.token = { json: { access_token: SECOND_TOKEN, scope: 'repo' } };
      script.user = { json: { login: 'octocat2' } };
      const a2 = await authorizeConnection(s);
      const res = await callback(s, `code=c2&state=${a2.state}`);
      expect(res.status).toBe(302);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(SECOND_TOKEN);
      const status = (await (await statusOf(s)).json()) as Record<string, unknown>;
      expect(status).toEqual({ connected: true, login: 'octocat2', scope: 'repo' });
    } finally {
      s.dispose();
    }
  });

  test('12. token 永不进 wire：status JSON 与 302 Location 均不含明文', async () => {
    const { s } = boot(HAPPY);
    try {
      const { state } = await authorizeConnection(s);
      const res = await callback(s, `code=c&state=${state}`);
      expect(res.headers.get('location') ?? '').not.toContain(TOKEN);
      const statusRes = await statusOf(s);
      const raw = await statusRes.text();
      expect(raw).not.toContain(TOKEN);
      expect(raw).not.toContain('v1:'); // SecretBox 密文信封同样不出 wire
    } finally {
      s.dispose();
    }
  });
});

describe('DELETE /api/teams/:id/github/connection（断开）', () => {
  test('11a. 有行 → 204 + status 回 connected:false + token 读出点归 null', async () => {
    const { s } = boot(HAPPY);
    try {
      const { state } = await authorizeConnection(s);
      await callback(s, `code=c&state=${state}`);
      const res = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/github/connection`);
      expect(res.status).toBe(204);
      expect(await (await statusOf(s)).json()).toEqual({ connected: false });
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBeNull();
    } finally {
      s.dispose();
    }
  });

  test('11b. 无行 → 204 幂等；未知 team → 404', async () => {
    const { s } = boot(HAPPY);
    try {
      const res = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/github/connection`);
      expect(res.status).toBe(204);
      const unknown = await req(s.app, 'DELETE', '/api/teams/nope/github/connection');
      expect(unknown.status).toBe(404);
    } finally {
      s.dispose();
    }
  });
});
