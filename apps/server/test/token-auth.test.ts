// 可选 token 鉴权（#251，spec #247 Implementation/Testing Decisions）：
// CAIRN_TOKEN 设 = 开、未设 = 关（关态零回归由全量套件担）。好测试 = 只打
// 外部行为（HTTP 请求级）——失败方式枚举先于实现固化（spec #247 十条中
// server 侧八条 + WARN 两条；门页两条归 #253 web 面）：
//   1. 开 + 无 token → /api/* 401 {error}
//   2. 开 + 错 token → 401
//   3. 开 + /api/machine/* 持机器凭证 → 照常（新闸不碰）
//   4. 开 + /git/* Basic api_key → 照常（无凭证 = git 自有 401 面，非新闸）
//   5. 开 + OAuth callback 无 token → 可达（bad state 仍 302 error 面）
//   6. 开 + 非 stream 端点带 ?token= → 401（query 面仅限两条 stream）
//   7. 开 + stream 端点 ?token= 正确 → 流建立（EventSource 无法设 header）
//   8. 开 + /_mp/* 与静态 SPA 壳 → 豁免（204 no-op 与非密 UI）
//   9. 0.0.0.0 显式绑定 + 关 → WARN 文案；默认绑定/回环/开 → 无 WARN
//  10. env 映射：CAIRN_TOKEN → authToken（空串 = 关）；HOST → host
//  11. 开 + /api/mcp 持有效 apiKey（无 CAIRN_TOKEN）→ 穿闸达 mcp 自有鉴权面
//      （XMON-49，02/A1 分体部署解锁：豁免四条 → 五条，与 machine/git 同族
//      = 自有 Bearer 凭证面；闸叠其上 = 单 header 双凭证死锁，mcp 整面死）
//  12. 开 + /api/mcp 无凭证 → mcp 自有 401（文案 ≠ 闸形状，钉来源面）；
//      CAIRN_TOKEN 冒充 apiKey → mcp 面 401（token 不升格为 MCP 凭证）

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { insecureBindWarning, loadConfig, warnInsecureBind } from '../src/config.js';
import { bootServer, insertGitApiKey, req, type TestServer } from './helpers.js';

const TOKEN = 'cairn-test-token-0123456789abcdef';
const authHeaders = { authorization: `Bearer ${TOKEN}` };

/** 带任意 header 的请求（helpers.req 不带 header 面）。 */
function reqWith(
  s: TestServer,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(
    s.app.request(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
}

const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('token 鉴权：保护面（失败方式 1/2/6）', () => {
  test('开 + 无 token → /api/* 401 {error} 同形', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await req(s.app, 'GET', '/api/teams');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: unknown };
    expect(typeof body.error).toBe('string');
  });

  test('开 + 错 Bearer token → 401', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await reqWith(s, 'GET', '/api/teams', { authorization: 'Bearer wrong-token' });
    expect(res.status).toBe(401);
  });

  test('开 + 正确 Bearer token → 照常 200（对照组）', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await reqWith(s, 'GET', '/api/teams', authHeaders);
    expect(res.status).toBe(200);
  });

  test('开 + 非 stream 端点带 ?token=（值正确）→ 401——query 面仅限两条 stream', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await req(s.app, 'GET', `/api/teams?token=${TOKEN}`);
    expect(res.status).toBe(401);
    // POST 面同样拒收 query token
    const post = await reqWith(
      s,
      'POST',
      `/api/projects?token=${TOKEN}`,
      { 'content-type': 'application/json' },
      { name: 'query-token-probe' },
    );
    expect(post.status).toBe(401);
  });
});

describe('token 鉴权：豁免面四条（失败方式 3/4/5/8）', () => {
  test('开 + /api/machine/* 持机器凭证（enroll Bearer apiKey）→ 照常，无需 CAIRN_TOKEN', async () => {
    const s = bootServer({ authToken: TOKEN });
    // api-key 发行端点在保护面内——持 CAIRN_TOKEN 取 key
    const issued = await reqWith(s, 'POST', `/api/teams/${s.team.id}/api-keys`, authHeaders, {
      name: 'machine-bootstrap',
      gitAccess: false,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
    });
    expect(issued.status).toBe(201);
    const { plaintext } = (await issued.json()) as { plaintext: string };
    // enroll = 机器自有凭证面（apiKey Bearer），新闸不碰
    const res = await reqWith(
      s,
      'POST',
      '/api/machine/enroll',
      { authorization: `Bearer ${plaintext}` },
      { teamId: s.team.id, name: 'lane-machine' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string };
    expect(typeof body.token).toBe('string');
    // 机器 token 面（非 enroll）同样豁免于新闸——自有 Bearer 校验担纲
    const me = await reqWith(s, 'GET', '/api/machine/me', {
      authorization: `Bearer ${body.token}`,
    });
    expect(me.status).toBe(200);
  });

  test('开 + /git/* → 新闸放行至 git 自有 Basic 面（无凭证 = git 401；api_key = 照常）', async () => {
    const s = bootServer({ authToken: TOKEN });
    const created = await reqWith(s, 'POST', '/api/projects', authHeaders, {
      name: 'git-exempt',
      repoKind: 'hosted',
    });
    expect(created.status).toBe(201);
    const record = (await created.json()) as { repoName: string };
    const gitPath = `/git/${s.team.id}/${record.repoName}/info/refs?service=git-upload-pack`;

    // 无凭证 → git 自有 401（WWW-Authenticate 担纲，非新闸 {error:'Unauthorized'} 面）
    const anon = await req(s.app, 'GET', gitPath);
    expect(anon.status).toBe(401);
    expect(anon.headers.get('www-authenticate')?.startsWith('Basic')).toBe(true);

    // 有效 Basic api_key(gitAccess) → 照常（git http-backend 200 广告面）
    const GIT_KEY = 'cairn_e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0';
    insertGitApiKey(s, GIT_KEY);
    const basic = Buffer.from(`git:${GIT_KEY}`).toString('base64');
    const authed = await reqWith(s, 'GET', gitPath, { authorization: `Basic ${basic}` });
    expect(authed.status).toBe(200);
  });

  test('开 + OAuth callback 无 token → 可达（bad state 仍走既有 302 error 面）', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await req(s.app, 'GET', '/api/oauth/callback?code=x&state=bogus-state');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('oauth=error&reason=state');
  });

  test('开 + /_mp/* 与静态 SPA 壳 → 豁免（204 no-op 与非密 UI）', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'cairn-token-spa-'));
    tmpDirs.push(webDir);
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>shell</title>');
    const s = bootServer({ authToken: TOKEN, webDir });

    const track = await req(s.app, 'POST', '/_mp/api/track');
    expect(track.status).toBe(204);

    const shell = await req(s.app, 'GET', '/');
    expect(shell.status).toBe(200);
    expect(shell.headers.get('content-type')).toContain('text/html');
    // SPA 回退面（客户端路由深链）同样豁免
    const deep = await req(s.app, 'GET', '/app/resources/providers');
    expect(deep.status).toBe(200);
  });
});

describe('token 鉴权：/api/mcp 豁免面（失败方式 11/12，XMON-49 豁免五条）', () => {
  // 与 machine/git 同族：自有 Bearer 凭证面（mcp-face verifyApiKey + key 级
  // 工具白名单），闸再叠一道 = 同一 Authorization header 要同时装 CAIRN_TOKEN
  // 与 apiKey 两个值——必死锁。豁免后自有鉴权自担（无/坏凭证照旧 mcp 401）。

  const ALL_READ = MCP_TOOL_REGISTRY.filter((t) => t.kind === 'read').map((t) => t.grant);
  const ALL_WRITE = MCP_TOOL_REGISTRY.filter((t) => t.kind === 'write').map((t) => t.grant);

  /** 发行面在保护面内——持 CAIRN_TOKEN 取 mcpAccess key（门页/闸同律）。 */
  async function issueMcpKey(s: TestServer): Promise<string> {
    const issued = await reqWith(s, 'POST', `/api/teams/${s.team.id}/api-keys`, authHeaders, {
      name: 'mcp-gate-probe',
      gitAccess: false,
      mcpAccess: true,
      toolGrants: { read: ALL_READ, write: ALL_WRITE },
    });
    expect(issued.status).toBe(201);
    const { plaintext } = (await issued.json()) as { plaintext: string };
    return plaintext;
  }

  function mcpInitialize(s: TestServer, bearer: string): Promise<Response> {
    return Promise.resolve(
      s.app.request('/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'token-auth-test', version: '0' },
          },
        }),
      }),
    );
  }

  test('开 + /api/mcp 持有效 apiKey（无 CAIRN_TOKEN）→ 穿闸达 mcp 自有面（initialize 200）', async () => {
    const s = bootServer({ authToken: TOKEN });
    const key = await issueMcpKey(s);
    const res = await mcpInitialize(s, key);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBeTruthy();
  });

  test('开 + /api/mcp 无凭证 → mcp 自有 401（错误文案 ≠ 闸形状，钉来源面）', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await Promise.resolve(
      s.app.request('/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    // mcp-face 文案（'mcp authentication required'）≠ 闸文案（'Unauthorized'）——
    // 断言前者 = 401 出自 mcp 自有鉴权面而非闸（豁免不产生无鉴权裸面）。
    expect(body.error).toBe('mcp authentication required');
  });

  test('开 + /api/mcp 持 CAIRN_TOKEN 冒充 apiKey → mcp 面 401（token 不升格为 MCP 凭证）', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await mcpInitialize(s, TOKEN);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('invalid api key');
  });
});

describe('token 鉴权：SSE stream ?token= 例外（失败方式 7）', () => {
  test('开 + team stream ?token= 正确 → 流建立（SSE 面）', async () => {
    const s = bootServer({ authToken: TOKEN, pingIntervalMs: 50 });
    const res = await Promise.resolve(
      s.app.request(`/api/teams/${s.team.id}/stream?token=${TOKEN}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    void res.body?.cancel().catch(() => {});
  });

  test('开 + conversation stream ?token= 正确 → 流建立', async () => {
    const s = bootServer({ authToken: TOKEN, pingIntervalMs: 50 });
    const res = await Promise.resolve(
      s.app.request(`/api/conversations/conv-probe/stream?token=${TOKEN}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    void res.body?.cancel().catch(() => {});
  });

  test('开 + stream 端点 ?token= 错 → 401；Bearer 头正确 → 同样放行', async () => {
    const s = bootServer({ authToken: TOKEN, pingIntervalMs: 50 });
    const bad = await req(s.app, 'GET', `/api/teams/${s.team.id}/stream?token=wrong`);
    expect(bad.status).toBe(401);
    const viaHeader = await reqWith(s, 'GET', `/api/teams/${s.team.id}/stream`, authHeaders);
    expect(viaHeader.status).toBe(200);
    void viaHeader.body?.cancel().catch(() => {});
  });
});

describe('保护面守卫：路径变体不绕过（审查加固，Spec#4/5 + 编码前缀绕过类）', () => {
  test('开 + 大小写/双斜杠变体无 token → 不达保护面（404，非 200 数据）', async () => {
    const s = bootServer({ authToken: TOKEN });
    for (const path of ['/API/teams', '//api/teams', '/api/../api/teams/']) {
      const res = await req(s.app, 'GET', path);
      expect(res.status, path).not.toBe(200);
    }
  });

  test('开 + 编码前缀 /%61pi/teams 无 token → 401（Hono getPath decodeURI 后命中保护路由，豁免判定不得漏）', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await req(s.app, 'GET', '/%61pi/teams');
    expect(res.status).toBe(401);
  });

  test('开 + 编码绕过类变体无 token → 一律 401（双重编码/大小写混合/编码后缀/编码豁免面）', async () => {
    const s = bootServer({ authToken: TOKEN });
    for (const path of [
      '/%2561pi/teams', // 双重编码
      '/%61PI/teams', // 编码 + 大小写混合
      '/api/%74eams', // 编码后缀（本就保护，钉住不回归）
      '/api/%6Fauth/callback?code=x&state=bogus', // 编码豁免面 → fail-closed 不豁免
      '/%61pi/mcp', // mcp 豁免面（XMON-49）编码变体 → 同律 fail-closed 不豁免
    ]) {
      const res = await req(s.app, 'GET', path);
      expect(res.status, path).toBe(401);
    }
  });

  test('开 + /api/mcp 段边界变体（/api/mcpfoo）无 token → 401（豁免 = 精确匹配，非前缀）', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await req(s.app, 'POST', '/api/mcpfoo');
    expect(res.status).toBe(401);
  });

  test('开 + 编码前缀路径持正确 Bearer → 闸放行，Hono 解码路由照常可达（200）', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await reqWith(s, 'GET', '/%61pi/teams', authHeaders);
    expect(res.status).toBe(200);
  });
});

describe('0.0.0.0 裸绑 WARN（失败方式 9/10）', () => {
  test('显式 0.0.0.0 + 鉴权关 → WARN 文案；默认绑定/回环/鉴权开 → 无 WARN', () => {
    // WARN 级别由入口 logger.warn 担（index.ts 接线，启动实测取证）；
    // 文案断言绑定面与开关名两要素。
    const warn = insecureBindWarning(loadConfig({ host: '0.0.0.0', authToken: null }));
    expect(warn).toMatch(/0\.0\.0\.0/);
    expect(warn).toMatch(/CAIRN_TOKEN/);
    expect(insecureBindWarning(loadConfig({ host: null, authToken: null }))).toBeNull();
    expect(insecureBindWarning(loadConfig({ host: '127.0.0.1', authToken: null }))).toBeNull();
    expect(insecureBindWarning(loadConfig({ host: '0.0.0.0', authToken: TOKEN }))).toBeNull();
  });

  test('入口接线：warnInsecureBind → logger.warn 恰发一行（stub 钉点，防接线回归）', () => {
    const calls: string[] = [];
    const stubLogger = {
      warn: (msg: string) => {
        calls.push(msg);
      },
    };
    warnInsecureBind(stubLogger, loadConfig({ host: '0.0.0.0', authToken: null }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/0\.0\.0\.0/);
    // 默认绑定 / 鉴权开 → 不发射
    warnInsecureBind(stubLogger, loadConfig({ host: null, authToken: null }));
    warnInsecureBind(stubLogger, loadConfig({ host: '0.0.0.0', authToken: TOKEN }));
    expect(calls).toHaveLength(1);
  });

  test('env 映射：CAIRN_TOKEN → authToken（空串 = 关）；HOST → host', () => {
    vi.stubEnv('CAIRN_TOKEN', TOKEN);
    vi.stubEnv('HOST', '0.0.0.0');
    expect(loadConfig().authToken).toBe(TOKEN);
    expect(loadConfig().host).toBe('0.0.0.0');
    vi.stubEnv('CAIRN_TOKEN', '');
    expect(loadConfig().authToken).toBeNull();
    vi.unstubAllEnvs();
    expect(loadConfig().authToken).toBeNull();
    expect(loadConfig().host).toBeNull();
  });
});
