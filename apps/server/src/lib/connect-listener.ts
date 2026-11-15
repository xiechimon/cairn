import { createServer, type IncomingMessage } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import type { Context, Hono, Next } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import type { TokenAuthOptions } from './token-auth.js';

const CONNECT_ORIGIN = Symbol('cairnConnectOrigin');
export const CONNECT_AUTH_COOKIE = '__Host-cairn_connect';

const GET_ROUTES = [
  /^\/api\/(?:auth\/session|user\/me|teams|projects|todos|tasks|needs-you)$/,
  /^\/api\/projects\/[^/]+\/todos$/,
  /^\/api\/todos\/[^/]+$/,
  /^\/api\/teams\/[^/]+\/(?:chief|chief\/threads|model-routing|machines|stream)$/,
  /^\/api\/conversations\/[^/]+\/(?:messages|stream)$/,
];
const POST_ROUTES = [
  /^\/api\/auth\/stream-ticket$/,
  /^\/api\/teams\/[^/]+\/chief\/threads$/,
  /^\/api\/conversations\/[^/]+\/messages$/,
  /^\/api\/projects\/[^/]+\/todos$/,
  /^\/api\/todos\/[^/]+\/(?:orchestrate|messages)$/,
  /^\/api\/teams\/[^/]+\/chief\/threads\/[^/]+\/stop$/,
  /^\/api\/teams\/[^/]+\/chief\/threads\/[^/]+\/questions\/[^/]+\/(?:answer|cancel)$/,
];
const STREAM_ROUTE = /^\/api\/(?:teams|conversations)\/[^/]+\/stream$/;
const SINGLE_HEADERS = new Set([
  'host',
  'authorization',
  'origin',
  'content-type',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
]);
const limitPairBody = bodyLimit({
  maxSize: 4096,
  onError: (c) => c.json({ error: 'pairing body too large' }, 413),
});

export function connectOriginOf(c: Context): string | null {
  const env = c.env as { [CONNECT_ORIGIN]?: string } | undefined;
  return env?.[CONNECT_ORIGIN] ?? null;
}

export async function admitConnectRequest(
  c: Context,
  next: Next,
  options: TokenAuthOptions,
  authEnabled: boolean,
) {
  if (!authEnabled) return c.json({ error: 'Connect requires token authentication' }, 503);
  const path = c.req.path;
  if (!path.startsWith('/api/') || path === '/api/remote/descriptor') return next();
  if (path === '/api/remote/pair') {
    if (c.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json') {
      return c.json({ error: 'pairing requires JSON' }, 415);
    }
    return limitPairBody(c, next);
  }
  const provided = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
  let deviceId = provided === undefined ? null : (options.resolveDeviceId?.(provided) ?? null);
  if (deviceId === null && STREAM_ROUTE.test(path)) {
    const ticket = new URL(c.req.url).searchParams.get('ticket');
    const session = ticket === null ? null : options.redeemTicket?.(ticket);
    if (session?.kind === 'device') deviceId = session.deviceId;
  }
  if (deviceId === null) {
    const cookie = getCookie(c, CONNECT_AUTH_COOKIE);
    const session = cookie === undefined ? null : options.resolveSession?.(cookie);
    if (session?.kind === 'device') deviceId = session.deviceId;
  }
  if (deviceId === null || options.isDeviceActive?.(deviceId) !== true) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('pairedDeviceId', deviceId);
  return next();
}

function canonicalPath(target: string): string | null {
  if (
    !target.startsWith('/') ||
    [...target].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) >= 127) ||
    target.includes('\\') ||
    target.includes('#') ||
    /%(?![a-f0-9]{2})/i.test(target)
  ) {
    return null;
  }
  const path = target.split('?')[0] ?? '';
  if (
    path.includes('%') ||
    path.includes('//') ||
    path.split('/').some((part) => part === '.' || part === '..')
  ) {
    return null;
  }
  return path;
}

function ambiguousHeaders(req: IncomingMessage): boolean {
  const seen = new Set<string>();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const key = req.rawHeaders[i]?.toLowerCase() ?? '';
    if (seen.has(key) && SINGLE_HEADERS.has(key)) return true;
    seen.add(key);
  }
  return (
    req.headers.upgrade !== undefined ||
    (req.headers['transfer-encoding'] !== undefined &&
      req.headers['transfer-encoding'] !== 'chunked') ||
    (req.headers['content-length'] !== undefined &&
      req.headers['transfer-encoding'] !== undefined) ||
    (req.headers.connection
      ?.split(',')
      .some((token) => !['close', 'keep-alive'].includes(token.trim().toLowerCase())) ??
      false) ||
    (req.headers.cookie
      ?.split(';')
      .filter((part) => part.split('=')[0]?.trim() === CONNECT_AUTH_COOKIE).length ?? 0) > 1
  );
}

export function openConnectListener(app: Hono, hostname: string, buildAssets: ReadonlySet<string>) {
  if (
    hostname.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      hostname,
    )
  ) {
    throw new Error('Connect requires the allocated lowercase hostname without a port');
  }
  const assets = new Set(buildAssets);
  for (const path of assets) {
    if (
      canonicalPath(path) !== path ||
      path.endsWith('/') ||
      !/\.(?:js|mjs|css|woff2?|ttf|svg|png|ico|webmanifest|webp|jpe?g)$/.test(path) ||
      path.startsWith('/api/') ||
      path.startsWith('/app/') ||
      path === '/' ||
      path === '/app'
    ) {
      throw new Error(
        'Connect assets must be exact canonical public build paths, without source maps',
      );
    }
  }
  const origin = `https://${hostname}`;
  const dispatch = getRequestListener(
    async (request, env) => {
      const url = new URL(request.url);
      const api = url.pathname.startsWith('/api/');
      const document =
        url.pathname === '/' || url.pathname === '/app' || url.pathname.startsWith('/app/');
      url.protocol = 'https:';
      if (document) url.pathname = '/';
      const headers = new Headers(request.headers);
      for (const key of [...headers.keys()]) {
        if (/^(?:forwarded$|x-forwarded-|x-real-ip$|cf-|tailscale-)/i.test(key))
          headers.delete(key);
      }
      const response = await app.fetch(
        new Request(url, {
          method: request.method,
          headers,
          body: request.body,
          signal: request.signal,
          ...(request.body === null ? {} : { duplex: 'half' }),
        }),
        {
          ...env,
          [CONNECT_ORIGIN]: origin,
        },
      );
      if (api) response.headers.set('cache-control', 'no-store');
      return response;
    },
    { overrideGlobalObjects: false },
  );
  let pairWindowStart = Date.now();
  let pairAttempts = 0;
  const server = createServer((req, res) => {
    const refuse = (status: number) => {
      res.writeHead(status, { 'cache-control': 'no-store', connection: 'close' });
      res.end();
    };
    const path = canonicalPath(req.url ?? '');
    if (path === null || ambiguousHeaders(req)) return refuse(400);
    if (req.headers.host !== hostname) return refuse(421);
    const method = req.method;
    const document = path === '/' || path === '/app' || path.startsWith('/app/');
    const allowed =
      (method === 'GET' &&
        (document ||
          path === '/api/remote/descriptor' ||
          GET_ROUTES.some((route) => route.test(path)))) ||
      ((method === 'GET' || method === 'HEAD') && assets.has(path)) ||
      (method === 'POST' &&
        (path === '/api/remote/pair' || POST_ROUTES.some((route) => route.test(path))));
    if (!allowed) return refuse(404);
    if (method === 'POST') {
      const site = req.headers['sec-fetch-site'];
      const mode = req.headers['sec-fetch-mode'];
      const dest = req.headers['sec-fetch-dest'];
      if (
        req.headers.origin !== origin ||
        (site !== undefined && site !== 'same-origin' && site !== 'none') ||
        (mode !== undefined && mode !== 'cors' && mode !== 'same-origin') ||
        (dest !== undefined && dest !== 'empty')
      )
        return refuse(403);
      if (path === '/api/remote/pair') {
        if (Date.now() - pairWindowStart >= 60_000) {
          pairWindowStart = Date.now();
          pairAttempts = 0;
        }
        if (++pairAttempts > 30) {
          res.setHeader('retry-after', '60');
          return refuse(429);
        }
      }
    }
    void dispatch(req, res);
  });
  server.on('upgrade', (_req, socket) =>
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n', () => socket.destroy()),
  );
  server.on('connect', (_req, socket) =>
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n', () => socket.destroy()),
  );
  server.on('checkContinue', (_req, res) => {
    res.writeHead(400, { connection: 'close' });
    res.end();
  });
  server.on('checkExpectation', (_req, res) => {
    res.writeHead(400, { connection: 'close' });
    res.end();
  });
  const ready = new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  let closed: Promise<void> | null = null;
  return {
    server,
    ready,
    close: () =>
      (closed ??= ready.then(
        () =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error === undefined ? resolve() : reject(error)));
            server.closeAllConnections();
          }),
      )),
  };
}
