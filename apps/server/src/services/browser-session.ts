import { randomBytes } from 'node:crypto';
import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Db } from '../db/client.js';
import { browserSession, pairingRequest } from '../db/schema.js';
import { hashCredential } from '../lib/hash.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { requestOrigin } from '../lib/request-origin.js';

export const AUTH_COOKIE = 'cairn_auth';
const MARK_COOKIE = 'cairn_browser';
const MARK_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MARK_BYTES = 32;
const PAIR_REQUEST_IN_FLIGHT_MS = 30_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EXTERNAL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TICKET_TTL_MS = 60_000;
const TOKEN_BYTES = 32;

export type BrowserSessionKind = 'owner' | 'device' | 'external';

export interface ResolvedBrowserSession {
  kind: BrowserSessionKind;
  deviceId: string | null;
}

export function forgetBrowserSignIn(db: Db, browserMarkHash: string | null): void {
  if (browserMarkHash === null) return;
  db.update(browserSession)
    .set({ browserMarkHash: null })
    .where(eq(browserSession.browserMarkHash, browserMarkHash))
    .run();
}

function supersedeBrowserPairRequests(db: Db, browserMarkHash: string | null, now = nowMs()): void {
  if (browserMarkHash === null) return;
  db.update(pairingRequest)
    .set({ status: 'superseded', decidedAt: now })
    .where(
      and(
        eq(pairingRequest.browserMarkHash, browserMarkHash),
        inArray(pairingRequest.status, ['pending', 'approved']),
        isNull(pairingRequest.deviceId),
      ),
    )
    .run();
}

export function browserJustSignedIn(db: Db, browserMarkHash: string, now: number): boolean {
  return (
    db
      .select({ id: browserSession.id })
      .from(browserSession)
      .where(
        and(
          eq(browserSession.browserMarkHash, browserMarkHash),
          gt(browserSession.createdAt, now - PAIR_REQUEST_IN_FLIGHT_MS),
        ),
      )
      .get() !== undefined
  );
}

export function issueBrowserSession(
  db: Db,
  kind: BrowserSessionKind,
  deviceId: string | null,
  browserMarkHash: string | null,
  now = nowMs(),
  notAfter = Number.POSITIVE_INFINITY,
): { token: string; expiresAt: number } {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const ttlMs = kind === 'external' ? EXTERNAL_SESSION_TTL_MS : SESSION_TTL_MS;
  const expiresAt = Math.min(now + ttlMs, notAfter);
  db.transaction((tx) => {
    tx.delete(browserSession).where(lte(browserSession.expiresAt, now)).run();
    tx.insert(browserSession)
      .values({
        id: newRecordId(),
        tokenHash: hashCredential(token),
        kind,
        deviceId,
        expiresAt,
        createdAt: now,
        browserMarkHash,
      })
      .run();
    supersedeBrowserPairRequests(tx, browserMarkHash, now);
  });
  return { token, expiresAt };
}

export function resolveBrowserSession(
  db: Db,
  token: string,
  now = nowMs(),
): ResolvedBrowserSession | null {
  const row = db
    .select()
    .from(browserSession)
    .where(eq(browserSession.tokenHash, hashCredential(token)))
    .get();
  if (row === undefined || row.expiresAt <= now) return null;
  if (row.kind !== 'owner' && row.kind !== 'device' && row.kind !== 'external') return null;
  return { kind: row.kind, deviceId: row.deviceId };
}

export function revokeBrowserSession(db: Db, token: string): void {
  db.delete(browserSession)
    .where(eq(browserSession.tokenHash, hashCredential(token)))
    .run();
}

export function revokeAllExternalBrowserSessions(db: Db): void {
  db.delete(browserSession).where(eq(browserSession.kind, 'external')).run();
}

export function clearAuthCookie(c: Context, secure: boolean): void {
  setCookie(c, AUTH_COOKIE, '', {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure,
    maxAge: 0,
  });
}

export function setAuthCookie(
  c: Context,
  token: string,
  secure: boolean,
  expiresAt = nowMs() + SESSION_TTL_MS,
): void {
  setCookie(c, AUTH_COOKIE, token, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure,
    maxAge: Math.max(0, Math.floor((expiresAt - nowMs()) / 1000)),
  });
}

export function browserMarkHashOf(c: Context): string | null {
  const mark = c.get('browserMark');
  return mark === undefined ? null : hashCredential(mark);
}

export function browserMarkMiddleware(secure: (c: Context) => boolean): MiddlewareHandler {
  return async (c, next) => {
    const sent = getCookie(c, MARK_COOKIE);
    const mark =
      sent !== undefined && MARK_PATTERN.test(sent)
        ? sent
        : randomBytes(MARK_BYTES).toString('base64url');
    c.set('browserMark', mark);
    await next();
    const signedOutProbe = c.req.method === 'GET' && c.res.status === 401;
    if (c.res.status >= 400 && !signedOutProbe) return;
    setCookie(c, MARK_COOKIE, mark, {
      httpOnly: true,
      path: '/api',
      sameSite: 'Lax',
      secure: secure(c),
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  };
}

declare module 'hono' {
  interface ContextVariableMap {
    browserMark: string;
  }
}

export function requestIsSecure(
  c: Context,
  trustedWebOrigin?: string,
  trustedProxies?: ReadonlySet<string>,
): boolean {
  return new URL(requestOrigin(c, trustedWebOrigin, trustedProxies)).protocol === 'https:';
}

interface Ticket {
  session: ResolvedBrowserSession;
  expiresAt: number;
}

export interface StreamTicketBook {
  issue(
    session: ResolvedBrowserSession,
    now?: number,
  ): {
    ticket: string;
    expiresAt: number;
  };
  redeem(ticket: string, now?: number): ResolvedBrowserSession | null;
}

export function createStreamTicketBook(): StreamTicketBook {
  const tickets = new Map<string, Ticket>();
  return {
    issue(session, now = nowMs()) {
      for (const [key, row] of tickets) {
        if (row.expiresAt <= now) tickets.delete(key);
      }
      const ticket = randomBytes(24).toString('base64url');
      const expiresAt = now + TICKET_TTL_MS;
      tickets.set(ticket, { session, expiresAt });
      return { ticket, expiresAt };
    },
    redeem(ticket, now = nowMs()) {
      const row = tickets.get(ticket);
      if (row === undefined) return null;
      tickets.delete(ticket);
      if (row.expiresAt <= now) return null;
      return row.session;
    },
  };
}
