import { timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, Hono } from 'hono';
import { sha256Hex } from './crypto.js';

const LOOPBACK_PEER_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const STREAM_PATH_PATTERNS = [
  /^\/api\/teams\/[^/]+\/stream$/,
  /^\/api\/conversations\/[^/]+\/stream$/,
];

function isExempt(pathname: string): boolean {
  if (pathname.includes('%')) return false;
  if (!pathname.startsWith('/api/')) return true;
  if (pathname === '/api/machine' || pathname.startsWith('/api/machine/')) return true;
  if (pathname === '/api/mcp') return true;
  if (pathname === '/api/oauth/callback') return true;
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

export function matchesAllowlistedTailscaleIdentity(
  c: Context,
  tailscaleUsers: readonly string[],
): boolean {
  if (tailscaleUsers.length === 0) return false;
  const tailscaleLogin = c.req.header('tailscale-user-login');
  if (tailscaleLogin === undefined || !tailscaleUsers.includes(tailscaleLogin)) return false;
  let peerAddress: string | undefined;
  try {
    peerAddress = getConnInfo(c).remote.address;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  return peerAddress !== undefined && LOOPBACK_PEER_ADDRESSES.has(peerAddress);
}

export function registerTokenAuth(
  app: Hono,
  token: string | null,
  tailscaleUsers: string[] = [],
): void {
  if (token === null) return;
  const verify = makeVerifier(token);
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    const pathname = url.pathname;
    if (isExempt(pathname)) return next();
    if (matchesAllowlistedTailscaleIdentity(c, tailscaleUsers)) return next();
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
