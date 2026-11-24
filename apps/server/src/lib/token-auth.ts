import { timingSafeEqual } from 'node:crypto';
import { BROWSER_AUTH_HEADER, BROWSER_SESSION_PATH, isBrowserAuthExempt } from '@cairn/shared';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { AUTH_COOKIE, type ResolvedBrowserSession } from '../services/browser-session.js';
import { sha256Hex } from './crypto.js';
import { type OwnerChannel, ownerChannelAdmits } from './owner-channel.js';
import { requestOrigin } from './request-origin.js';

export { isOpenRemotePath } from '@cairn/shared';

const STREAM_PATH_PATTERNS = [
  /^\/api\/teams\/[^/]+\/stream$/,
  /^\/api\/conversations\/[^/]+\/stream$/,
];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const PAIRED_DIAGNOSTIC_PATTERNS = [
  /^\/api\/teams\/[^/]+\/claude-subscriptions\/[^/]+\/(?:upstream-models|test|verify)$/,
  /^\/api\/teams\/[^/]+\/devin-subscriptions\/[^/]+\/(?:upstream-models|verify)$/,
  /^\/api\/teams\/[^/]+\/antigravity-subscriptions\/[^/]+\/(?:upstream-models|verify)$/,
];
const OWNER_ONLY_SKILL_POST_PATTERN = /^\/api\/teams\/[^/]+\/skills\/(?:import|[^/]+\/refresh)$/;
const OWNER_ONLY_PATTERNS = [
  /^\/api\/computers(?:\/[^/]+)?$/,
  /^\/api\/teams\/[^/]+\/(?:api-keys|secrets|providers|claude-subscriptions|devin-subscriptions|antigravity-subscriptions|mcp-connectors)(?:\/|$)/,
  /^\/api\/teams\/[^/]+\/github\/(?:oauth|connection|webhook)(?:\/|$)/,
  /^\/api\/machines\/[^/]+(?:\/|$)/,
];

export function isOwnerOnlyRoute(method: string, pathname: string): boolean {
  const verb = method.toUpperCase();
  const read = READ_METHODS.has(verb);
  if (
    pathname === '/api/remote/pairing' ||
    pathname.startsWith('/api/remote/pairing/') ||
    pathname === '/api/remote/pairing-requests' ||
    pathname.startsWith('/api/remote/pairing-requests/') ||
    pathname === '/api/remote/tailnet' ||
    pathname === '/api/remote/tunnel' ||
    pathname === '/api/remote/account/signin' ||
    pathname === '/api/remote/account/signout' ||
    pathname === '/api/remote/shares' ||
    (pathname === '/api/remote/tailscale' && !read) ||
    (pathname.startsWith('/api/remote/devices') && !read)
  )
    return true;
  if (read) return false;
  if (verb === 'POST') {
    if (OWNER_ONLY_SKILL_POST_PATTERN.test(pathname)) return true;
    if (PAIRED_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(pathname))) return false;
  }
  return OWNER_ONLY_PATTERNS.some((pattern) => pattern.test(pathname));
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

export interface TokenAuthOptions {
  resolveDeviceId?: (provided: string) => string | null;
  resolveSession?: (cookie: string) => ResolvedBrowserSession | null;
  redeemTicket?: (ticket: string) => ResolvedBrowserSession | null;
  ownerChannel?: OwnerChannel;
  accessExchange?: boolean;
}

export type OwnerIdentity = { via: 'session' | 'access' };

declare module 'hono' {
  interface ContextVariableMap {
    pairedDeviceId: string;
    ownerIdentity: OwnerIdentity;
  }
}

const requireBrowserOriginProof: MiddlewareHandler = async (c, next) => {
  c.header('cache-control', 'no-store');
  const site = c.req.header('sec-fetch-site');
  if (c.req.header(BROWSER_AUTH_HEADER) !== '1' || (site !== undefined && site !== 'same-origin')) {
    return c.body(null, 403);
  }
  const origin = c.req.header('origin');
  if (origin !== undefined && origin !== requestOrigin(c)) return c.body(null, 403);
  return next();
};

export function sameOriginPageWrite(c: Context): boolean {
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
    if (rawName !== name) continue;
    try {
      return decodeURIComponent(rest.join('='));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function applySession(c: Context, session: ResolvedBrowserSession): Response | null {
  if (session.kind === 'owner' || session.kind === 'external') {
    c.set('ownerIdentity', { via: session.kind === 'external' ? 'access' : 'session' });
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
  app.use(BROWSER_SESSION_PATH, requireBrowserOriginProof);
  app.on('POST', '/api/remote/pair', requireBrowserOriginProof);
  app.on('POST', '/api/remote/pair/request', requireBrowserOriginProof);
  app.on('POST', '/api/remote/pair/claim', requireBrowserOriginProof);
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
    if (isBrowserAuthExempt(pathname)) return next();
    const admit = () => {
      if (pairedDeviceIdOf(c) !== null && isOwnerOnlyRoute(c.req.method, c.req.path)) {
        return c.json({ error: 'only the owner token can do this' }, 403);
      }
      if (!READ_METHODS.has(c.req.method.toUpperCase())) {
        return (
          ownerChannelAdmits(c, options.ownerChannel, options.accessExchange === true) ?? next()
        );
      }
      return next();
    };
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
        if (!READ_METHODS.has(c.req.method.toUpperCase()) && !sameOriginPageWrite(c)) {
          return c.json({ error: 'same-origin proof required' }, 403);
        }
        return admit();
      }
    }
    if (c.req.path === '/api/auth/session') return c.body(null, 401);
    return c.json({ error: 'Unauthorized' }, 401);
  });
}
