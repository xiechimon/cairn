import { timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, Hono } from 'hono';
import { AUTH_COOKIE, type ResolvedBrowserSession } from '../services/browser-session.js';
import { sha256Hex } from './crypto.js';

const LOOPBACK_PEER_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const STREAM_PATH_PATTERNS = [
  /^\/api\/teams\/[^/]+\/stream$/,
  /^\/api\/conversations\/[^/]+\/stream$/,
];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const OWNER_ONLY_PATTERNS = [
  /^\/api\/computers(?:\/[^/]+)?$/,
  /^\/api\/job-applications(?:\/|$)/,
  /^\/api\/teams\/[^/]+\/(?:api-keys|secrets|providers|claude-subscriptions)(?:\/|$)/,
  /^\/api\/teams\/[^/]+\/github\/(?:oauth|connection)(?:\/|$)/,
  /^\/api\/machines\/[^/]+(?:\/|$)/,
];

export function isOwnerOnlyRoute(method: string, pathname: string): boolean {
  if (
    pathname === '/api/machine/enroll/confirm' ||
    pathname === '/api/remote/pairing' ||
    pathname.startsWith('/api/remote/pairing/') ||
    (pathname.startsWith('/api/remote/devices') && !READ_METHODS.has(method.toUpperCase()))
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
  if (pathname === '/api/auth/bootstrap') return true;
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
  resolveSession?: (cookie: string) => ResolvedBrowserSession | null;
  redeemTicket?: (ticket: string) => ResolvedBrowserSession | null;
}

export type OwnerIdentity = { via: 'session' };

declare module 'hono' {
  interface ContextVariableMap {
    pairedDeviceId: string;
    ownerIdentity: OwnerIdentity;
  }
}

function cookieWriteAllowed(c: Context): boolean {
  const site = c.req.header('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') return true;
  if (site !== undefined) return false;
  const origin = c.req.header('origin');
  if (origin === undefined) return false;
  try {
    const expected = new URL(c.req.url);
    const actual = new URL(origin);
    return actual.protocol === expected.protocol && actual.host === expected.host;
  } catch {
    return false;
  }
}

function cookieValue(c: Context, name: string): string | undefined {
  const header = c.req.header('cookie');
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function applySession(c: Context, session: ResolvedBrowserSession): Response | null {
  if (session.kind === 'owner') {
    c.set('ownerIdentity', { via: 'session' });
    return null;
  }
  if (session.deviceId === null) return c.json({ error: 'Unauthorized' }, 401);
  c.set('pairedDeviceId', session.deviceId);
  return null;
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
      if (verifyOwner(provided)) {
        c.set('ownerIdentity', { via: 'session' });
        return true;
      }
      const deviceId = options.resolveDeviceId?.(provided) ?? null;
      if (deviceId === null) return false;
      c.set('pairedDeviceId', deviceId);
      return true;
    };
    const url = new URL(c.req.url);
    const pathname = url.pathname;
    if (isExempt(pathname)) return next();
    const admit = () =>
      pairedDeviceIdOf(c) !== null && isOwnerOnlyRoute(c.req.method, c.req.path)
        ? c.json({ error: 'only the owner token can do this' }, 403)
        : next();
    const authorization = c.req.header('authorization');
    if (authorization !== undefined) {
      const match = /^Bearer\s+(.+)$/i.exec(authorization);
      if (match !== null && verify(match[1] ?? '')) return admit();
    }
    if (STREAM_PATH_PATTERNS.some((pattern) => pattern.test(pathname))) {
      const ticket = url.searchParams.get('ticket');
      const session = ticket === null ? null : (options.redeemTicket?.(ticket) ?? null);
      if (session !== null) {
        const denied = applySession(c, session);
        if (denied !== null) return denied;
        return admit();
      }
    }
    const cookie = cookieValue(c, AUTH_COOKIE);
    if (cookie !== undefined) {
      const session = options.resolveSession?.(cookie) ?? null;
      if (session !== null) {
        const denied = applySession(c, session);
        if (denied !== null) return denied;
        if (!READ_METHODS.has(c.req.method.toUpperCase()) && !cookieWriteAllowed(c)) {
          return c.json({ error: 'same-origin proof required' }, 403);
        }
        return admit();
      }
    }
    return c.json({ error: 'Unauthorized' }, 401);
  });
}
