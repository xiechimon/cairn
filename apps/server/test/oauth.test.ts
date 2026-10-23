// OAuth 握手面（#231：一族打通 = github-copilot；M6 Q2/Q5「任一连通即过」）。
// 缝位：authorize 签发 + callback 收码 + token 密封落 provider.apiKeyCipher
// （只写不读，02 §8）；出站 token 交换经 lib/github.ts OAuth 面（GitHub
// 出站唯一缝，#223），fetch 注入位 = ctx.oauthFetch。
//
// 失败方式清单（先于实现固化）：
//  1. authorize：未知族（anthropic 等未开通）→ 404
//  2. authorize：oauth 未配置（client id/secret 缺）→ 400
//  3. authorize happy → 200 {authorizationUrl}：client_id/redirect_uri/scope/
//     state 四参齐；state 入册
//  4. callback：state 不在册 → 302 相对回 providers 页 ?oauth=error&reason=state
//     （#243：覆盖伪造/二访/重启蒸发三形；相对路径不引入请求方 origin——
//     「不信任外部 returnOrigin」纪律不变，只改着陆形状，裸 400 退役）
//  5. callback：state 过期（>30min TTL，#243 人环余量）→ 302 回 entry.origin
//     ?oauth=error&reason=state（entry 在册 = origin 可信）
//  6. callback：state 单次核销——同 state 二访 → 302 reason=state（同 4）
//  7. callback happy（mock 上游 {access_token}）→ 302 <origin>/app/resources/
//     providers?oauth=connected&provider=github-copilot；provider 行建立；
//     openProviderKey 解出 token === mock 值；GET providers 投影无 token
//  8. 重连：二次 happy → 同行重密封（不撞 409、不增行），新 token 生效
//  9. callback：上游交换非 ok（400）→ 302 ?oauth=error&reason=exchange
// 10. callback：上游 200 但缺 access_token → 302 ?oauth=error&reason=exchange
// 11. callback：fetch throw（网络断）→ 302 ?oauth=error&reason=exchange
// 12. callback：用户在 GitHub 拒绝（?error=access_denied 无 code）→
//     302 ?oauth=error&reason=denied（state 一并核销）
// 13. 落库行形状：kind=custom / authHeader=true / api/baseUrl = 族模板
//     [设计] / models=[]；record 投影无 apiKey 字段（02 §8 写只读）
// 14. callback：state 在窗（29min）→ 正常连通（TTL 人环窗行为钉，#243——
//     防 TTL 回落短窗；10min 已在 M6 联调被 handoff 间隔撞穿一次）
// 15. callback：denied 路 + state 过期 → 302 回 entry.origin reason=state
//     （abort 分支与收码分支同律，#243）

import { describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context.js';
import { openProviderKey } from '../src/services/providers.js';
import { bootServer, req, type TestServer } from './helpers.js';

/** mock OAuth 上游（GitHub token 端点）：记呼叫、按剧本回包。 */
function mockOAuthFetch(script: { status?: number; json?: unknown; throw?: boolean }) {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = async (input: string | URL, init?: { body?: string }) => {
    calls.push({ url: String(input), body: init?.body ?? '' });
    if (script.throw) throw new Error('network down');
    const status = script.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => script.json,
      text: async () => JSON.stringify(script.json),
    };
  };
  return { calls, fetchImpl };
}

const CLIENT = { clientId: 'cid-test', clientSecret: 'cs-test' };
const ORIGIN = 'http://127.0.0.1:8787';

function bootOAuth(
  script: Parameters<typeof mockOAuthFetch>[0],
  opts: { client?: AppContext['oauthClient'] } = {},
) {
  const mock = mockOAuthFetch(script);
  const s = bootServer({
    oauthClient: opts.client === undefined ? CLIENT : opts.client,
    oauthFetch: mock.fetchImpl as AppContext['oauthFetch'],
  });
  return { s, mock };
}

/** authorize → 从 authorizationUrl 提 state（黑盒：不从内部 map 取）。 */
async function authorize(s: TestServer, preset = 'github-copilot') {
  const res = await s.app.request(`/api/teams/${s.team.id}/providers/oauth/${preset}/authorize`, {
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

/** 拨快 state 在册年龄（授权黑盒签发后唯一的入册干预口；TTL 窗内外剧本共用）。 */
function ageState(s: TestServer, state: string | null, minutesAgo: number) {
  if (state === null) throw new Error('state missing');
  const entry = s.oauthStates.get(state);
  if (!entry) throw new Error('state missing');
  entry.createdAt -= minutesAgo * 60 * 1000;
}

describe('POST /api/teams/:id/providers/oauth/:preset/authorize', () => {
  it('1. 未知族 → 404', async () => {
    const { s } = bootOAuth({ json: {} });
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/providers/oauth/anthropic/authorize`,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('anthropic');
  });

  it('2. oauth 未配置 → 400', async () => {
    const { s } = bootOAuth({ json: {} }, { client: null });
    const { res, body } = await authorize(s);
    expect(res.status).toBe(400);
    expect(body.error).toContain('CAIRN_GITHUB_OAUTH_CLIENT_ID');
  });

  it('3. happy：签发授权 URL 四参齐 + state 入册', async () => {
    const { s } = bootOAuth({ json: {} });
    const { res, url, state } = await authorize(s);
    expect(res.status).toBe(200);
    if (!url) throw new Error('authorizationUrl missing');
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url?.searchParams.get('client_id')).toBe(CLIENT.clientId);
    expect(url?.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/oauth/callback`);
    expect(url?.searchParams.get('scope')).toBe('read:user');
    expect(state).toBeTruthy();
    expect(s.oauthStates.has(state as string)).toBe(true);
  });
});

describe('GET /api/oauth/callback', () => {
  it('4. state 不在册 → 302 相对回 providers 页 reason=state', async () => {
    const { s } = bootOAuth({ json: { access_token: 'gho_x' } });
    const res = await callback(s, 'code=c1&state=bogus');
    expect(res.status).toBe(302);
    // 无可信 origin：相对 Location，浏览器同源解析（不读请求方任何 origin）
    expect(res.headers.get('location')).toBe('/app/resources/providers?oauth=error&reason=state');
  });

  it('5. state 过期 → 302 回 entry.origin reason=state', async () => {
    const { s } = bootOAuth({ json: { access_token: 'gho_x' } });
    const { state } = await authorize(s);
    ageState(s, state, 31); // 拨快过 30min TTL（#243）
    const res = await callback(s, `code=c1&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `${ORIGIN}/app/resources/providers?oauth=error&reason=state`,
    );
  });

  it('6. state 单次核销：二访 → 302 reason=state', async () => {
    const { s } = bootOAuth({ json: { access_token: 'gho_once' } });
    const { state } = await authorize(s);
    const first = await callback(s, `code=c1&state=${state}`);
    expect(first.status).toBe(302);
    const second = await callback(s, `code=c1&state=${state}`);
    expect(second.status).toBe(302);
    expect(second.headers.get('location')).toBe(
      '/app/resources/providers?oauth=error&reason=state',
    );
  });

  it('7. happy 全链：302 回 providers 页 + token 密封落库 + GET 投影无 token', async () => {
    const { s, mock } = bootOAuth({
      json: { access_token: 'gho_mocktoken', token_type: 'bearer' },
    });
    const { state } = await authorize(s);
    const res = await callback(s, `code=mockcode&state=${state}`);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toBe(
      `${ORIGIN}/app/resources/providers?oauth=connected&provider=github-copilot`,
    );
    // 交换请求打向 GitHub token 端点，带 code + client 对
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.url).toBe('https://github.com/login/oauth/access_token');
    expect(mock.calls[0]?.body).toContain('code=mockcode');
    expect(mock.calls[0]?.body).toContain(`client_id=${CLIENT.clientId}`);
    // token 密封落 provider 行（只写不读：内部读点可解，GET 投影无）
    const opened = openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'github-copilot');
    expect(opened?.apiKey).toBe('gho_mocktoken');
    const list = await req(s.app, 'GET', `/api/teams/${s.team.id}/providers`);
    const envelope = (await list.json()) as { providers: Record<string, unknown>[] };
    const row = envelope.providers.find((p) => p.providerId === 'github-copilot');
    expect(row).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain('gho_mocktoken');
    expect(row).not.toHaveProperty('apiKey');
  });

  it('8. 重连：同行重密封不增行', async () => {
    const script: { json: unknown } = { json: { access_token: 'gho_first' } };
    const mock = mockOAuthFetch(script);
    const s = bootServer({
      oauthClient: CLIENT,
      oauthFetch: mock.fetchImpl as AppContext['oauthFetch'],
    });
    const a1 = await authorize(s);
    await callback(s, `code=c1&state=${a1.state}`);
    // 二次连接：上游发新 token（剧本换值——断言新值落库才证明重密封真发生）
    script.json = { access_token: 'gho_second' };
    const a2 = await authorize(s);
    const res = await callback(s, `code=c2&state=${a2.state}`);
    expect(res.status).toBe(302);
    const list = await req(s.app, 'GET', `/api/teams/${s.team.id}/providers`);
    const envelope = (await list.json()) as { providers: { providerId: string }[] };
    expect(envelope.providers.filter((p) => p.providerId === 'github-copilot')).toHaveLength(1);
    const opened = openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'github-copilot');
    expect(opened?.apiKey).toBe('gho_second');
    expect(mock.calls).toHaveLength(2);
  });

  it('9. 上游交换非 ok → 302 error=exchange', async () => {
    const { s } = bootOAuth({ status: 400, json: { error: 'bad_verification_code' } });
    const { state } = await authorize(s);
    const res = await callback(s, `code=bad&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `${ORIGIN}/app/resources/providers?oauth=error&reason=exchange`,
    );
  });

  it('10. 上游 200 但缺 access_token → 302 error=exchange', async () => {
    const { s } = bootOAuth({ json: { token_type: 'bearer' } });
    const { state } = await authorize(s);
    const res = await callback(s, `code=c&state=${state}`);
    expect(res.headers.get('location')).toContain('oauth=error&reason=exchange');
  });

  it('11. fetch throw（网络断）→ 302 error=exchange', async () => {
    const { s } = bootOAuth({ throw: true });
    const { state } = await authorize(s);
    const res = await callback(s, `code=c&state=${state}`);
    expect(res.headers.get('location')).toContain('oauth=error&reason=exchange');
  });

  it('12. 用户在 GitHub 拒绝 → 302 error=denied + state 核销', async () => {
    const { s, mock } = bootOAuth({ json: { access_token: 'gho_x' } });
    const { state } = await authorize(s);
    const res = await callback(s, `error=access_denied&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `${ORIGIN}/app/resources/providers?oauth=error&reason=denied`,
    );
    expect(s.oauthStates.has(state as string)).toBe(false);
    expect(mock.calls).toHaveLength(0); // 拒绝路径不打 token 端点
  });

  it('13. 落库行形状：族模板 + record 投影无 apiKey', async () => {
    const { s } = bootOAuth({ json: { access_token: 'gho_shape' } });
    const { state } = await authorize(s);
    await callback(s, `code=c&state=${state}`);
    const list = await req(s.app, 'GET', `/api/teams/${s.team.id}/providers`);
    const envelope = (await list.json()) as { providers: Record<string, unknown>[] };
    const row = envelope.providers.find((p) => p.providerId === 'github-copilot');
    expect(row?.kind).toBe('custom');
    expect(row?.authHeader).toBe(true);
    expect(row?.api).toBe('openai-completions');
    expect(row?.baseUrl).toBe('https://api.githubcopilot.com');
    expect(row?.models).toEqual([]);
    expect(row).not.toHaveProperty('apiKey');
  });

  it('14. state 在窗（29min）→ 正常连通（TTL 人环窗行为钉）', async () => {
    const { s } = bootOAuth({ json: { access_token: 'gho_window' } });
    const { state } = await authorize(s);
    ageState(s, state, 29); // 窗内边缘：慢人环（登录+2FA+停顿）仍应过
    const res = await callback(s, `code=c1&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `${ORIGIN}/app/resources/providers?oauth=connected&provider=github-copilot`,
    );
  });

  it('15. denied 路 + state 过期 → 302 reason=state（abort 同律）', async () => {
    const { s, mock } = bootOAuth({ json: { access_token: 'gho_x' } });
    const { state } = await authorize(s);
    ageState(s, state, 31); // 拨快过 TTL
    const res = await callback(s, `error=access_denied&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `${ORIGIN}/app/resources/providers?oauth=error&reason=state`,
    );
    expect(mock.calls).toHaveLength(0); // 过期在交换前拦截，不打 token 端点
  });
});
