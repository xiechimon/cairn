import { readFileSync } from 'node:fs';
import { PAIRING_CODE_TTL_MS } from '@cairn/shared';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect, test } from 'vitest';
import * as schema from '../src/db/schema.js';
import { browserSession, pairedDevice, pairingGrant } from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import {
  issueBrowserSession,
  resolveBrowserSession,
  resolveRelayBrowserSession,
  revokeRelayBrowserSessions,
} from '../src/services/browser-session.js';
import {
  issuePairingGrant,
  listPairingGrants,
  pairFromGrant,
  redeemPairingGrant,
  revokePairedDevice,
  revokeRelayPairingGrants,
} from '../src/services/paired-devices.js';
import { bootServer } from './helpers.js';

const INSTALLATION = '18f959f1-3627-4c49-a631-598315bc3d1f';
const OTHER_INSTALLATION = '18f959f1-3627-4c49-a631-598315bc3d10';
const SCOPE = { installationId: INSTALLATION, generation: 7 };
const OWNER = 'relay-scope-test-owner-0123456789abcdef';

test('the additive migration preserves pre-scope private credentials as null scope', () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE paired_device (id TEXT PRIMARY KEY);');
    sqlite.exec(
      readFileSync(new URL('../drizzle/0148_browser_session.sql', import.meta.url), 'utf8'),
    );
    const now = Date.now();
    sqlite
      .prepare(
        'INSERT INTO browser_session (id, tokenHash, kind, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)',
      )
      .run('legacy-session', hashCredential('legacy-cookie'), 'owner', now + 60_000, now);
    sqlite
      .prepare('INSERT INTO pairing_grant (id, codeHash, expiresAt, createdAt) VALUES (?, ?, ?, ?)')
      .run('legacy-grant', hashCredential('legacy-grant-code'), now + 60_000, now);
    sqlite.exec(
      readFileSync(new URL('../drizzle/0166_relay_session_scope.sql', import.meta.url), 'utf8'),
    );
    const db = drizzle(sqlite, { schema });
    expect(db.select().from(browserSession).get()?.relayScope).toBeNull();
    expect(db.select().from(pairingGrant).get()?.relayScope).toBeNull();
    expect(resolveBrowserSession(db, 'legacy-cookie')).toEqual({ kind: 'owner', deviceId: null });
    expect(redeemPairingGrant(db, 'legacy-grant-code', undefined, SCOPE)).toBe(false);
    expect(redeemPairingGrant(db, 'legacy-grant-code')).toBe(true);
  } finally {
    sqlite.close();
  }
});

test('relay grants reject private, different installation and old generation without consumption', async () => {
  const s = bootServer({ authToken: OWNER });
  const issued = issuePairingGrant(s.db, undefined, SCOPE);
  const input = { code: issued.code, teamId: s.team.id, name: 'relay phone' };
  expect(listPairingGrants(s.db)).toEqual([]);
  for (const relayScope of [
    undefined,
    { ...SCOPE, installationId: OTHER_INSTALLATION },
    { ...SCOPE, generation: 8 },
  ]) {
    expect(pairFromGrant(s.db, { ...input, relayScope })).toBeNull();
  }
  const privateAttempt = await s.app.request('/api/remote/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: issued.code, name: 'phone' }),
  });
  expect(privateAttempt.status).toBe(401);
  expect(s.db.select().from(pairedDevice).all()).toHaveLength(0);
  expect(s.db.select().from(browserSession).all()).toHaveLength(0);
  const paired = pairFromGrant(s.db, { ...input, relayScope: SCOPE });
  expect(paired).not.toBeNull();
  expect(pairFromGrant(s.db, { ...input, relayScope: SCOPE })).toBeNull();
  expect(s.db.select().from(pairedDevice).all()).toHaveLength(1);
  expect(resolveBrowserSession(s.db, paired!.sessionToken)).toBeNull();
  for (const path of ['/api/user/me', '/api/auth/stream-ticket']) {
    const denied = await s.app.request(path, {
      method: path.endsWith('stream-ticket') ? 'POST' : 'GET',
      headers: { cookie: `cairn_auth=${paired!.sessionToken}`, 'sec-fetch-site': 'same-origin' },
    });
    expect(denied.status).toBe(401);
  }
});

test('private grants cannot be converted to relay credentials and private HTTP stays compatible', async () => {
  const s = bootServer({ authToken: OWNER });
  const issued = issuePairingGrant(s.db);
  const input = { code: issued.code, teamId: s.team.id, name: 'private phone' };
  expect(pairFromGrant(s.db, { ...input, relayScope: SCOPE })).toBeNull();
  expect(listPairingGrants(s.db)).toEqual([
    expect.objectContaining({ id: issued.id, expiresAt: issued.expiresAt }),
  ]);
  const paired = pairFromGrant(s.db, input)!;
  expect(resolveBrowserSession(s.db, paired.sessionToken)).toEqual({
    kind: 'device',
    deviceId: paired.device.id,
  });
  expect(
    resolveRelayBrowserSession(s.db, {
      tokenHash: hashCredential(paired.sessionToken),
      installationId: INSTALLATION,
      teamId: s.team.id,
    }),
  ).toBeNull();
  expect(
    (
      await s.app.request('/api/user/me', {
        headers: { cookie: `cairn_auth=${paired.sessionToken}` },
      })
    ).status,
  ).toBe(200);
});

test('relay session bindings revalidate persisted identity, team, kind, expiry and device revocation', () => {
  const s = bootServer();
  const issued = issuePairingGrant(s.db, undefined, SCOPE);
  const paired = pairFromGrant(s.db, {
    code: issued.code,
    teamId: s.team.id,
    name: 'phone',
    relayScope: SCOPE,
  })!;
  const binding = {
    tokenHash: hashCredential(paired.sessionToken),
    installationId: INSTALLATION,
    teamId: s.team.id,
  };
  const resolved = resolveRelayBrowserSession(s.db, binding)!;
  expect(resolved).toEqual({
    id: expect.any(String),
    deviceId: paired.device.id,
    expiresAt: paired.sessionExpiresAt,
  });
  for (const changed of [
    { ...binding, installationId: OTHER_INSTALLATION },
    { ...binding, tokenHash: 'f'.repeat(64) },
    { ...binding, teamId: 'not-the-personal-team' },
  ]) {
    expect(resolveRelayBrowserSession(s.db, changed)).toBeNull();
  }
  expect(resolveRelayBrowserSession(s.db, binding, resolved.expiresAt - 1)).not.toBeNull();
  expect(resolveRelayBrowserSession(s.db, binding, resolved.expiresAt)).toBeNull();
  s.db
    .update(browserSession)
    .set({ kind: 'owner' })
    .where(eq(browserSession.id, resolved.id))
    .run();
  expect(resolveRelayBrowserSession(s.db, binding)).toBeNull();
  s.db
    .update(browserSession)
    .set({ kind: 'device' })
    .where(eq(browserSession.id, resolved.id))
    .run();
  expect(revokePairedDevice(s.db, s.team.id, paired.device.id)).toBe(true);
  expect(resolveRelayBrowserSession(s.db, binding)).toBeNull();
  expect(s.db.select().from(browserSession).all()).toEqual([]);
});

test('scoped grant failure rolls back redemption and expiry remains one-use', () => {
  const s = bootServer();
  const issued = issuePairingGrant(s.db, undefined, SCOPE);
  const input = { code: issued.code, name: 'phone', relayScope: SCOPE };
  expect(() => pairFromGrant(s.db, { ...input, teamId: 'missing-team' })).toThrow();
  expect(s.db.select().from(pairingGrant).get()?.redeemedAt).toBeNull();
  expect(s.db.select().from(pairedDevice).all()).toHaveLength(0);
  expect(s.db.select().from(browserSession).all()).toHaveLength(0);
  expect(pairFromGrant(s.db, { ...input, teamId: s.team.id })).not.toBeNull();
  const past = Date.now() - PAIRING_CODE_TTL_MS;
  const expired = issuePairingGrant(s.db, past, SCOPE);
  expect(redeemPairingGrant(s.db, expired.code, expired.expiresAt, SCOPE)).toBe(false);
});

test('disable revokes only installation grants across generations; remove also invalidates its sessions', () => {
  const s = bootServer();
  const scopes = [
    SCOPE,
    { ...SCOPE, generation: 8 },
    { ...SCOPE, installationId: OTHER_INSTALLATION },
  ];
  const pending = scopes.map((scope) => issuePairingGrant(s.db, undefined, scope));
  const privateGrant = issuePairingGrant(s.db);
  const sessions = scopes.map((relayScope) => {
    const grant = issuePairingGrant(s.db, undefined, relayScope);
    return pairFromGrant(s.db, { code: grant.code, teamId: s.team.id, name: 'phone', relayScope })!;
  });
  const privateSession = issueBrowserSession(s.db, 'owner');
  revokeRelayPairingGrants(s.db, INSTALLATION);
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i]!;
    expect(redeemPairingGrant(s.db, pending[i]!.code, undefined, scope)).toBe(i === 2);
    expect(
      resolveRelayBrowserSession(s.db, {
        tokenHash: hashCredential(sessions[i]!.sessionToken),
        installationId: scope.installationId,
        teamId: s.team.id,
      }),
    ).not.toBeNull();
  }
  expect(redeemPairingGrant(s.db, privateGrant.code)).toBe(true);
  revokeRelayBrowserSessions(s.db, INSTALLATION);
  for (let i = 0; i < scopes.length; i++) {
    expect(
      resolveRelayBrowserSession(s.db, {
        tokenHash: hashCredential(sessions[i]!.sessionToken),
        installationId: scopes[i]!.installationId,
        teamId: s.team.id,
      }) !== null,
    ).toBe(i === 2);
  }
  expect(resolveBrowserSession(s.db, privateSession.token)?.kind).toBe('owner');
});
