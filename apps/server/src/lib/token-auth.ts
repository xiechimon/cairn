// 可选 token 鉴权中间件（#251，spec #247 Implementation Decisions——全仓
// 唯一新缝：app 组装处一道 HTTP 中间件，路由面零散鉴权检查禁止）。
// CAIRN_TOKEN 设 = 开、未设 = 关（关 = 不注册，行为与现状完全一致）。
//
// 传输：Bearer 头为主干道；唯一例外 = 两条 SSE stream 端点接受 `?token=`
// query（原生 EventSource 无法设 header 的协议限制）——其余端点拒收 query
// token（防日志泄漏面扩散）。比对 = sha256 定长哈希 + timingSafeEqual
// （routes.ts git Basic 面同款哈希卫生）。
//
// 豁免清单（绕过面 = 仅此六条：spec #247 钉死四条 + XMON-49 增补 /api/mcp，
// 02/A1 分体部署解锁——闸叠在自有 Bearer 面上 = 同一 Authorization header 要
// 同时装 CAIRN_TOKEN 与 apiKey 两个值，必死锁，远端 MCP 消费面整面死；
// #1137 增补 /api/webhook/ 前缀——GitHub webhook 无法自定义 Authorization
// 头，receiver 自带路径 token 闸（webhook_token 哈希反查，machine/mcp 族
// 同款「自有凭证 + 默认保护」结构））：
//   1. `/api/machine/*`——自有 Bearer（apiKey enroll + 机器 token 哈希比对）；
//   2. `/git/*`——自有 Basic → api_key(gitAccess) 哈希比对；
//   3. `/api/mcp`——自有 Bearer → apiKey 哈希比对（同 1/2 族，XMON-49）；
//   4. `/api/oauth/callback`——state 参数担 CSRF，豁免后 state 校验仍强制；
//   5. `/_mp/*` + 静态 SPA 壳——204 no-op 与非密 UI；
//   6. `/api/webhook/*`——自有路径 token（`POST /api/webhook/github/:token`，
//      token 哈希反查 + lastUsedAt；token mgmt 端点在 /api/teams/ 下不豁免）。
// 路径判定用 URL pathname（WHATWG URL 已归一化 `..` 段）。**编码面 fail-
// closed**：pathname 含 `%` 一律不豁免（走闸）——Hono getPath 对含 % 路径做
// `%25` 预转义 + decodeURI 后进路由匹配（hono/dist/utils/url.js），编码前缀
// （`/%61pi/…`）会解码命中保护路由；镜像其解码语义太脆，而合法客户端
// （machine daemon / git client / GitHub 回跳 / vite 产物名）从不编码结构性
// 路径段，一刀走闸最简且最紧（双重编码、大小写混合、编码豁免面同律）。
// 豁免谓词 = 非 `/api/` 前缀整面放行（2/5 条与静态壳同判），`/api/` 内仅
// 1/3/4 条三条白名单——`/api/` 下默认保护、仅白名单豁免的 fail-closed 语义。

import { timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import { sha256Hex } from './crypto.js';

/** 两条 SSE stream 端点（`?token=` 仅此二处；:id 段不含 `/`）。 */
const STREAM_PATH_PATTERNS = [
  /^\/api\/teams\/[^/]+\/stream$/,
  /^\/api\/conversations\/[^/]+\/stream$/,
];

function isExempt(pathname: string): boolean {
  // 编码面 fail-closed（模块头注）：含 % 一律不豁免，闸先于 Hono 的解码路由。
  if (pathname.includes('%')) return false;
  // 非 /api/ 面 = /git/*、/_mp/*、静态 SPA 壳（豁免条 2/4 的并集；SPA 壳本身
  // 即「所有非 API 前缀路径」开放集，app.ts API_PREFIXES 为界）。守卫性质：
  // 大小写/双斜杠变体（/API/、//api/）落入本豁免但 Hono 路由不命中 → 404，
  // 不达保护面（test/token-auth.test.ts 钉住）。**新增任何非 /api/ 协议前缀
  // 路由时必须回访本谓词**——否则会静默绕过闸。
  if (!pathname.startsWith('/api/')) return true;
  // /api/ 下默认保护，仅三条白名单豁免：
  // 机器面（豁免条 1）——前缀严格到段边界，/api/machinefoo 不豁免
  if (pathname === '/api/machine' || pathname.startsWith('/api/machine/')) return true;
  // MCP 面（豁免条 3，XMON-49）——精确匹配，/api/mcpfoo 不豁免（同族自有
  // Bearer：apiKey 哈希比对 + key 级工具白名单，mcp-face 自担鉴权）
  if (pathname === '/api/mcp') return true;
  // OAuth 回跳（豁免条 4）
  if (pathname === '/api/oauth/callback') return true;
  // webhook receiver（豁免条 6，#1137）——前缀严格到段边界，/api/webhookfoo
  // 不豁免（machine 同律）；receiver 自带路径 token 闸（哈希反查，错值 401）。
  if (pathname === '/api/webhook' || pathname.startsWith('/api/webhook/')) return true;
  return false;
}

/** 定长哈希比对（明文长度不泄漏；timingSafeEqual 前置长度恒等）。 */
function makeVerifier(token: string): (provided: string) => boolean {
  const expected = Buffer.from(sha256Hex(token));
  return (provided) => {
    const actual = Buffer.from(sha256Hex(provided));
    return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
  };
}

/** token = null（默认关）→ 不注册任何中间件；设值 → `*` 面一道闸。
 * 401 形状 = 既有 `{error}` 单形状同形（app.onError 族）。 */
export function registerTokenAuth(app: Hono, token: string | null): void {
  if (token === null) return;
  const verify = makeVerifier(token);
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    const pathname = url.pathname;
    if (isExempt(pathname)) return next();
    const authorization = c.req.header('authorization');
    if (authorization !== undefined) {
      const match = /^Bearer\s+(.+)$/i.exec(authorization);
      if (match !== null && verify(match[1] ?? '')) return next();
    }
    if (STREAM_PATH_PATTERNS.some((pattern) => pattern.test(pathname))) {
      const queryToken = url.searchParams.get('token');
      if (queryToken !== null && verify(queryToken)) return next();
    }
    return c.json({ error: 'Unauthorized' }, 401);
  });
}
