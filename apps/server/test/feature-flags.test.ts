import { afterEach, describe, expect, test } from 'vitest';
import { user as userTable } from '../src/db/schema.js';
import {
  flag,
  isOwner,
  releaseFlag,
  setUserFlag,
  validFlagKey,
} from '../src/services/feature-flags.js';
import { bootServer, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

function boot() {
  const s = bootServer();
  servers.push(s);
  s.db.insert(userTable).values({ id: 'user-b', displayName: 'B', avatarUrl: null }).run();
  s.db.insert(userTable).values({ id: 'user-a', displayName: 'A', avatarUrl: null }).run();
  return s;
}

describe('flag defaults', () => {
  test('the first user is the owner and others are not', () => {
    const s = boot();
    expect(isOwner(s.db, s.user.id)).toBe(true);
    expect(isOwner(s.db, 'user-b')).toBe(false);
    expect(isOwner(s.db, 'missing')).toBe(false);
  });

  test('an unset flag is on for the owner and off for everyone else', () => {
    const s = boot();
    expect(flag(s.db, 'new-thing', s.user.id)).toBe(true);
    expect(flag(s.db, 'new-thing', 'user-b')).toBe(false);
    expect(flag(s.db, 'new-thing', 'missing')).toBe(false);
  });
});

describe('per-user flags and release', () => {
  test('a flag on for user A is off for user B until released', () => {
    const s = boot();
    setUserFlag(s.db, 'beta', 'user-a', true);
    expect(flag(s.db, 'beta', 'user-a')).toBe(true);
    expect(flag(s.db, 'beta', 'user-b')).toBe(false);
    releaseFlag(s.db, 'beta');
    expect(flag(s.db, 'beta', 'user-b')).toBe(true);
  });

  test('release turns the flag on for every user including ones with an override off', () => {
    const s = boot();
    setUserFlag(s.db, 'beta', 'user-b', false);
    setUserFlag(s.db, 'beta', s.user.id, false);
    releaseFlag(s.db, 'beta');
    for (const id of [s.user.id, 'user-a', 'user-b']) expect(flag(s.db, 'beta', id)).toBe(true);
  });

  test('release leaves other flags untouched', () => {
    const s = boot();
    releaseFlag(s.db, 'beta');
    expect(flag(s.db, 'other', 'user-b')).toBe(false);
  });

  test('an override off beats the owner default', () => {
    const s = boot();
    setUserFlag(s.db, 'beta', s.user.id, false);
    expect(flag(s.db, 'beta', s.user.id)).toBe(false);
  });

  test('setting and releasing twice keeps one row per scope', () => {
    const s = boot();
    setUserFlag(s.db, 'beta', 'user-a', true);
    setUserFlag(s.db, 'beta', 'user-a', false);
    releaseFlag(s.db, 'beta');
    releaseFlag(s.db, 'beta');
    expect(flag(s.db, 'beta', 'user-a')).toBe(true);
  });

  test('flag keys must be lowercase slugs', () => {
    expect(validFlagKey('new-thing_2')).toBe(true);
    expect(validFlagKey('')).toBe(false);
    expect(validFlagKey('Bad Key')).toBe(false);
  });
});

describe('POST /api/flags/:key/release', () => {
  test('releases the flag for everyone and answers with the key', async () => {
    const s = boot();
    expect(flag(s.db, 'beta', 'user-b')).toBe(false);
    const res = await req(s.app, 'POST', '/api/flags/beta/release');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: 'beta', released: true });
    expect(flag(s.db, 'beta', 'user-b')).toBe(true);
  });

  test('rejects an invalid key', async () => {
    const s = boot();
    const res = await req(s.app, 'POST', '/api/flags/Bad%20Key/release');
    expect(res.status).toBe(400);
  });
});
