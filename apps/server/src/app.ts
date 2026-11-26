import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { BROWSER_SESSION_PATH } from '@cairn/shared';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import type { Logger } from 'pino';
import type { AppContext } from './context.js';
import { HttpError } from './lib/errors.js';
import { limitApiRequestBody } from './lib/request-body-limit.js';
import { registerTokenAuth } from './lib/token-auth.js';
import { registerRoutes } from './routes.js';
import { registerMachineAuth, registerMachineRoutes } from './routes-machine.js';
import { registerRemoteRoutes } from './routes-remote.js';
import {
  browserMarkMiddleware,
  requestIsSecure,
  resolveBrowserSession,
} from './services/browser-session.js';
import { NotFoundError } from './services/builds.js';
import {
  deviceStreamsOf,
  pairedDeviceExists,
  pairedDeviceIdOfToken,
} from './services/paired-devices.js';
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
const HASHED_ASSET_PREFIX = 'assets/';
const HASHED_ASSET_CACHE = 'public, max-age=31536000, immutable';
const UNHASHED_FILE_CACHE = 'public, max-age=3600';

function registerStaticSpa(app: Hono, webDir: string): void {
  const root = resolve(webDir);
  const indexFile = join(root, 'index.html');
  app.get('/*', compress(), async (c) => {
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
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      if (!existsSync(indexFile) || rel.startsWith(HASHED_ASSET_PREFIX)) {
        return c.json({ error: 'Not found' }, 404);
      }
      filePath = indexFile;
    }
    const isIndex = filePath === indexFile;
    const body = await readFile(filePath);
    c.header('content-type', CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream');
    c.header(
      'cache-control',
      isIndex
        ? 'no-cache'
        : rel.startsWith(HASHED_ASSET_PREFIX)
          ? HASHED_ASSET_CACHE
          : UNHASHED_FILE_CACHE,
    );
    return c.body(new Uint8Array(body));
  });
}

const BROWSER_MARK_PATHS = [
  BROWSER_SESSION_PATH,
  '/api/auth/access',
  '/api/auth/clerk',
  '/api/auth/signout',
  '/api/remote/pair',
  '/api/remote/pair/request',
  '/api/remote/pair/claim',
];

export function createApp(ctx: AppContext, logger?: Logger): Hono {
  const app = new Hono();
  const markBrowser = browserMarkMiddleware((c) =>
    requestIsSecure(c, ctx.webOrigin, ctx.trustedProxies),
  );
  for (const path of BROWSER_MARK_PATHS) app.use(path, markBrowser);
  registerTokenAuth(app, ctx.authToken, {
    ownerChannel: ctx.ownerChannel,
    accessExchange: ctx.accessVerifier != null || ctx.clerkAuth != null,
    webOrigin: ctx.webOrigin,
    trustedProxies: ctx.trustedProxies,
    resolveDeviceId: (provided) => pairedDeviceIdOfToken(ctx.db, provided),
    resolveSession: (cookie) => {
      const resolved = resolveBrowserSession(ctx.db, cookie);
      if (resolved?.kind !== 'device') return resolved;
      if (
        resolved.deviceId === null ||
        deviceStreamsOf(ctx.db).isRevoked(resolved.deviceId) ||
        !pairedDeviceExists(ctx.db, resolved.deviceId)
      ) {
        return null;
      }
      return resolved;
    },
    redeemTicket: (ticket) => {
      const session = ctx.streamTickets.redeem(ticket);
      if (session?.kind !== 'device') return session;
      if (
        session.deviceId === null ||
        deviceStreamsOf(ctx.db).isRevoked(session.deviceId) ||
        !pairedDeviceExists(ctx.db, session.deviceId)
      ) {
        return null;
      }
      return session;
    },
  });
  const deviceStreams = deviceStreamsOf(ctx.db);
  app.use('/api/*', async (c, next) => {
    c.set('deviceStreams', deviceStreams);
    await next();
  });
  app.use('/api/*', compress());
  registerMachineAuth(app, ctx);
  app.use('/api/*', limitApiRequestBody);
  registerRoutes(app, ctx);
  registerMachineRoutes(app, ctx);
  registerRemoteRoutes(app, ctx);
  if (ctx.webDir) registerStaticSpa(app, ctx.webDir);

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(
        {
          error: err.message,
          ...(err.reason !== undefined ? { reason: err.reason } : {}),
          ...err.fields,
        },
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
