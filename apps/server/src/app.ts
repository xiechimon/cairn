// Hono app 组装：路由 + 统一错误形状 {"error": …}（04 §3 错误形状对拍面，
// 样本 = r5 §1 实测 400）+ SPA 静态同源托管（02/A1，M5：web 产物目录存在时
// 非 API GET 一律走静态文件/ index.html 回退——单页应用路由客户端持有）。

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import type { Logger } from 'pino';
import type { AppContext } from './context.js';
import { HttpError } from './lib/errors.js';
import { nowMs } from './lib/ids.js';
import { registerTokenAuth } from './lib/token-auth.js';
import { registerRoutes } from './routes.js';
import { registerMachineRoutes } from './routes-machine.js';
import { countsAsMemberWrite, recordMemberWrite } from './services/autonomy-gates.js';
import { NotFoundError } from './services/builds.js';
import { PhaseTransitionError } from './services/phase.js';

/** 静态面 content-type 表（vite 产物 + PWA 文件族；未知扩展 = octet-stream）。 */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

/** API/协议前缀（静态回退不适用——未命中 = 404 JSON，与 notFound 同形）。 */
const API_PREFIXES = ['/api/', '/git/', '/_mp/'];

/** SPA 静态同源托管（02/A1）：webDir = vite build 产物根（apps/web/dist）。
 * 同步 fs 读（单用户 self-host，better-sqlite3 同纪律 [设计]）；index.html
 * no-cache、带 hash 资产 1h 缓存。路径逃逸防御：resolve 后必须仍在根内。 */
function registerStaticSpa(app: Hono, webDir: string): void {
  const root = resolve(webDir);
  const indexFile = join(root, 'index.html');
  app.get('/*', (c) => {
    const { pathname } = new URL(c.req.url);
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
    if (API_PREFIXES.some((p) => decoded.startsWith(p))) {
      return c.json({ error: 'Not found' }, 404);
    }
    const rel = decoded.replace(/^\/+/, '');
    let filePath = rel === '' ? indexFile : resolve(join(root, rel));
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      return c.json({ error: 'Not found' }, 404); // 路径逃逸（../）
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, 'index.html');
    }
    let isIndex = false;
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      // SPA 回退：未知路径 → index.html（客户端路由持有 /app 树，01 §4.1）。
      if (!existsSync(indexFile)) return c.json({ error: 'Not found' }, 404);
      filePath = indexFile;
      isIndex = true;
    }
    const body = readFileSync(filePath);
    c.header('content-type', CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream');
    c.header('cache-control', isIndex ? 'no-cache' : 'public, max-age=3600');
    return c.body(new Uint8Array(body));
  });
}

/** #1491 人在用就让路：/api/ 上人发的写请求成功后记一笔时刻（后台自动任务的
 * 闸读它）。记账失败不影响请求本身。 */
function registerMemberActivity(app: Hono, ctx: AppContext): void {
  app.use('/api/*', async (c, next) => {
    await next();
    if (!countsAsMemberWrite(c.req.method, c.req.path, c.res.status)) return;
    try {
      recordMemberWrite(ctx.db, nowMs());
    } catch {
      // 记不上 = 闸少看到一次人的操作；请求照常返回。
    }
  });
}

export function createApp(ctx: AppContext, logger?: Logger): Hono {
  const app = new Hono();
  // 可选 token 鉴权闸（#251）：全仓唯一新缝，先于一切路由注册；null = 不注册。
  registerTokenAuth(app, ctx.authToken);
  registerMemberActivity(app, ctx);
  registerRoutes(app, ctx);
  registerMachineRoutes(app, ctx);
  if (ctx.webDir) registerStaticSpa(app, ctx.webDir);

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      // reason 可选位（#386）：可分类错误随 {error} 携带 code；未分类错误面
      // wire 形状不变（{error} 单形状，wire.test 对拍面）。
      return c.json(
        err.reason !== undefined
          ? { error: err.message, reason: err.reason }
          : { error: err.message },
        err.status as 400,
      );
    }
    if (err instanceof NotFoundError) {
      return c.json({ error: err.message }, 404);
    }
    if (err instanceof PhaseTransitionError) {
      return c.json({ error: err.message }, 409);
    }
    logger?.error({ err }, 'unhandled error');
    return c.json({ error: 'Internal server error' }, 500);
  });
  return app;
}
