import { chiefIdFormat } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test, vi } from 'vitest';
import { chief, computer, machine, user } from '../src/db/schema.js';
import { computerScreensOf } from '../src/services/computer-screen.js';
import { bootServer, type TestServer } from './helpers.js';

let s: TestServer;
afterEach(() => {
  if (s) {
    computerScreensOf(s).close();
    s.dispose();
  }
  vi.useRealTimers();
});

test('denied screen minting does not expire another private owner lease', async () => {
  vi.useFakeTimers();
  const path = boot();
  s.db
    .update(computer)
    .set({
      scopeKey: 'chief:missing',
      controlHolder: 'user',
      controlLeaseId: 'foreign-expired-lease',
      controlLeaseExpiresAt: Date.now() - 1,
    })
    .where(eq(computer.id, 'computer-screen'))
    .run();
  const response = await s.app.request(`${path}/screen`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'view' }),
  });
  expect(response.status).toBe(404);
  expect(s.db.select().from(computer).get()?.controlLeaseId).toBe('foreign-expired-lease');
});

test.each(['foreign', 'unknown', 'orphan'])(
  'private %s scope cannot mint, acquire, renew or release via a team peer',
  async (scope) => {
    const path = boot();
    computerScreensOf(s);
    const foreignId = chiefIdFormat('foreign-owner', s.team.id);
    s.db
      .insert(user)
      .values({ id: 'foreign-owner', displayName: 'Foreign owner', avatarUrl: null })
      .run();
    s.db
      .insert(chief)
      .values({ id: foreignId, userId: 'foreign-owner', teamId: s.team.id, createdAt: 1 })
      .run();
    s.db
      .update(computer)
      .set({
        scopeKey:
          scope === 'foreign'
            ? `chief:${foreignId}`
            : scope === 'orphan'
              ? 'chief:missing'
              : 'unknown:scope',
        controlHolder: 'user',
        controlLeaseId: 'foreign-lease',
        controlLeaseExpiresAt: Date.now() + 60000,
      })
      .where(eq(computer.id, 'computer-screen'))
      .run();
    for (const [method, endpoint, body] of [
      ['POST', '/screen', { kind: 'view' }],
      ['POST', '/control', {}],
      ['PATCH', '/control', { leaseId: 'foreign-lease' }],
      ['DELETE', '/control', { leaseId: 'foreign-lease' }],
    ] as const) {
      const response = await s.app.request(path + endpoint, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(404);
    }
    expect(s.db.select().from(computer).get()?.controlLeaseId).toBe('foreign-lease');
  },
);
function boot(authToken: string | null = null) {
  s = bootServer({ authToken });
  s.db
    .insert(chief)
    .values({
      id: chiefIdFormat(s.user.id, s.team.id),
      userId: s.user.id,
      teamId: s.team.id,
      createdAt: 1,
    })
    .run();
  s.db.insert(machine).values({ id: 'screen-machine', teamId: s.team.id, name: 'screen' }).run();
  s.db
    .insert(computer)
    .values({
      id: 'computer-screen',
      teamId: s.team.id,
      machineId: 'screen-machine',
      scopeKey: `chief:${chiefIdFormat(s.user.id, s.team.id)}`,
      providerRef: 'test-computer',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  s.machineHub.subscribeMachine(s.team.id, 'screen-machine', () => {});
  return `/api/teams/${s.team.id}/computers/computer-screen`;
}

test('screen capability minting is behind normal owner API authentication', async () => {
  const path = boot('owner-test-token');
  expect(
    (
      await s.app.request(`${path}/screen`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'view' }),
      })
    ).status,
  ).toBe(401);
  const response = await s.app.request(`${path}/screen`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner-test-token' },
    body: JSON.stringify({ kind: 'view' }),
  });
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(JSON.stringify(await response.json())).not.toContain('owner-test-token');
});

test('control acquire, renew and release use the same lease id', async () => {
  const path = boot();
  const created = await s.app.request(`${path}/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  expect(created.status).toBe(201);
  const lease = (await created.json()) as { leaseId: string };
  for (const method of ['PATCH', 'DELETE']) {
    const response = await s.app.request(`${path}/control`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leaseId: lease.leaseId }),
    });
    expect(response.status).toBe(200);
  }
});

test('other-team routes and unsupported screen requests fail closed', async () => {
  const path = boot();
  const other = path.replace(s.team.id, 'other-team');
  expect(
    (
      await s.app.request(`${other}/control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await s.app.request(`${path}/screen`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'admin', socketPath: '/tmp/arbitrary' }),
      })
    ).status,
  ).toBe(400);
});

test('simple cross-origin form requests and oversized capability bodies are refused', async () => {
  const path = boot();
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded']) {
    expect(
      (
        await s.app.request(`${path}/control`, {
          method: 'POST',
          headers: { 'content-type': contentType },
          body: '{}',
        })
      ).status,
    ).toBe(415);
  }
  expect(
    (
      await s.app.request(`${path}/screen`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'view', padding: 'a'.repeat(5000) }),
      })
    ).status,
  ).toBe(413);
});
