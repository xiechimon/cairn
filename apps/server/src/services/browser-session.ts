import { randomBytes } from 'node:crypto';
import { eq, lte } from 'drizzle-orm';
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import type { Db } from '../db/client.js';
import { browserSession } from '../db/schema.js';
import { hashCredential } from '../lib/hash.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { tailnetListenerOf } from '../lib/tailnet-listener.js';

export const AUTH_COOKIE = 'cairn_auth';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TICKET_TTL_MS = 60_000;
const TOKEN_BYTES = 32;

export type BrowserSessionKind = 'owner' | 'device';

export interface ResolvedBrowserSession {
  kind: BrowserSessionKind;
  deviceId: string | null;
}

export function issueBrowserSession(
  db: Db,
  kind: BrowserSessionKind,
  deviceId: string | null = null,
  now = nowMs(),
): { token: string; expiresAt: number } {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const expiresAt = now + SESSION_TTL_MS;
  db.delete(browserSession).where(lte(browserSession.expiresAt, now)).run();
  db.insert(browserSession)
    .values({
      id: newRecordId(),
      tokenHash: hashCredential(token),
      kind,
      deviceId,
      expiresAt,
      createdAt: now,
    })
    .run();
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
  if (row.kind !== 'owner' && row.kind !== 'device') return null;
  return { kind: row.kind, deviceId: row.deviceId };
}

export function setAuthCookie(c: Context, token: string, secure: boolean): void {
  setCookie(c, AUTH_COOKIE, token, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function requestIsSecure(c: Context): boolean {
  if (tailnetListenerOf(c) !== null) return true;
  if (c.req.header('x-forwarded-proto') === 'https') return true;
  return new URL(c.req.url).protocol === 'https:';
}

interface Ticket {
  session: ResolvedBrowserSession;
  expiresAt: number;
}

const tickets = new Map<string, Ticket>();

export function issueStreamTicket(
  session: ResolvedBrowserSession,
  now = nowMs(),
): {
  ticket: string;
  expiresAt: number;
} {
  for (const [key, row] of tickets) {
    if (row.expiresAt <= now) tickets.delete(key);
  }
  const ticket = randomBytes(24).toString('base64url');
  const expiresAt = now + TICKET_TTL_MS;
  tickets.set(ticket, { session, expiresAt });
  return { ticket, expiresAt };
}

export function redeemStreamTicket(ticket: string, now = nowMs()): ResolvedBrowserSession | null {
  const row = tickets.get(ticket);
  if (row === undefined) return null;
  tickets.delete(ticket);
  if (row.expiresAt <= now) return null;
  return row.session;
}

export function sessionFromRequest(
  db: Db,
  cookie: string | undefined,
): ResolvedBrowserSession | null {
  if (cookie === undefined || cookie === '') return null;
  return resolveBrowserSession(db, cookie);
}
