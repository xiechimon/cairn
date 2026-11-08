import { timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, Hono } from 'hono';
import { sha256Hex } from './crypto.js';
import { tailnetOriginOf, tailnetOwnerIdentityOf } from './tailnet-listener.js';

const LOOPBACK_PEER_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const STREAM_PATH_PATTERNS = [
  /^\/api\/teams\/[^/]+\/stream$/,
  /^\/api\/conversations\/[^/]+\/stream$/,
];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const OWNER_ONLY_PATTERNS = [
  /^\/api\/teams\/[^/]+\/(?:api-keys|secrets|providers|claude-subscriptions|feishu)(?:\/|$)/,
  /^\/api\/teams\/[^/]+\/github\/(?:oauth|connection)(?:\/|$)/,
  /^\/api\/machines\/[^/]+(?:\/|$)/,
];

export function isOwnerOnlyRoute(method: string, pathname: string): boolean {
  if (
    pathname === '/api/machine/enroll/confirm' ||
    pathname === '/api/remote/pairing' ||
    pathname.startsWith('/api/remote/devices')
  )
    return true;
  if (READ_METHODS.has(method.toUpperCase())) return false;
  return OWNER_ONLY_PATTERNS.some((pattern) => pattern.test(pathname));
}

const OPEN_REMOTE_PATHS = new Set(['/api/remote/descriptor', '/api/remote/pair']);

export function isOpenRemotePath(pathname: string): boolean {
  return OPEN_REMOTE_PATHS.has(pathname);
}

function isExempt(pathname: string): boolean {
  if (pathname.includes('%')) return false;
  if (!pathname.startsWith('/api/')) return true;
  if (
    pathname !== '/api/machine/enroll/confirm' &&
    (pathname === '/api/machine' || pathname.startsWith('/api/machine/'))
  )
    return true;
  if (pathname === '/api/mcp') return true;
  if (pathname === '/api/oauth/callback') return true;
  if (isOpenRemotePath(pathname)) return true;
  return false;
}

function makeVerifier(token: string): (provided: string) => boolean {
  const expected = Buffer.from(sha256Hex(token));
  return (provided) => {
    const actual = Buffer.from(sha256Hex(provided));
    return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
  };
}

export function matchesAuthToken(expected: string, provided: string): boolean {
  return makeVerifier(expected)(provided);
}

export function isLoopbackPeer(c: Context): boolean {
  let peerAddress: string | undefined;
  try {
    peerAddress = getConnInfo(c).remote.address;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  return peerAddress !== undefined && LOOPBACK_PEER_ADDRESSES.has(peerAddress);
}

export interface TokenAuthOptions {
  resolveDeviceId?: (provided: string) => string | null;
}

declare module 'hono' {
  interface ContextVariableMap {
    pairedDeviceId: string;
    tailnetOwnerLogin: string;
  }
}

export function pairedDeviceIdOf(c: Context): string | null {
  return c.get('pairedDeviceId') ?? null;
}

export function registerTokenAuth(
  app: Hono,
  token: string | null,
  options: TokenAuthOptions = {},
): void {
  if (token === null) return;
  const verifyOwner = makeVerifier(token);
  app.use('*', async (c, next) => {
    const verify = (provided: string): boolean => {
      if (verifyOwner(provided)) return true;
      const deviceId = options.resolveDeviceId?.(provided) ?? null;
      if (deviceId === null) return false;
      c.set('pairedDeviceId', deviceId);
      return true;
    };
    const url = new URL(c.req.url);
    const pathname = url.pathname;
    if (isExempt(pathname)) return next();
    const admit = () =>
      pairedDeviceIdOf(c) !== null && isOwnerOnlyRoute(c.req.method, pathname)
        ? c.json({ error: 'only the owner token can do this' }, 403)
        : next();
    const authorization = c.req.header('authorization');
    if (authorization !== undefined) {
      const match = /^Bearer\s+(.+)$/i.exec(authorization);
      if (match !== null && verify(match[1] ?? '')) return admit();
    }
    if (STREAM_PATH_PATTERNS.some((pattern) => pattern.test(pathname))) {
      const queryToken = url.searchParams.get('token');
      if (queryToken !== null && verify(queryToken)) return admit();
    }
    const identity = tailnetOwnerIdentityOf(c);
    if (identity !== null) {
      if (
        !READ_METHODS.has(c.req.method.toUpperCase()) &&
        c.req.header('sec-fetch-site') !== 'same-origin' &&
        c.req.header('origin') !== tailnetOriginOf(c)
      ) {
        return c.json({ error: 'same-origin proof required for Tailscale identity' }, 403);
      }
      c.set('tailnetOwnerLogin', identity.login);
      return next();
    }
    return c.json({ error: 'Unauthorized' }, 401);
  });
}
