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

const API_PREFIXES = ['/api/', '/git/', '/_mp/'];

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
      return c.json({ error: 'Not found' }, 404);
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, 'index.html');
    }
    let isIndex = false;
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
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

function registerMemberActivity(app: Hono, ctx: AppContext): void {
  app.use('/api/*', async (c, next) => {
    await next();
    if (!countsAsMemberWrite(c.req.method, c.req.path, c.res.status)) return;
    try {
      recordMemberWrite(ctx.db, nowMs());
    } catch {}
  });
}

export function createApp(ctx: AppContext, logger?: Logger): Hono {
  const app = new Hono();
  registerTokenAuth(app, ctx.authToken, ctx.tailscaleUsers);
  registerMemberActivity(app, ctx);
  registerRoutes(app, ctx);
  registerMachineRoutes(app, ctx);
  if (ctx.webDir) registerStaticSpa(app, ctx.webDir);

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
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
