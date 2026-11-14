import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import { computer, machine, pairedDevice, team } from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-keys.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { bootServer, type TestServer } from './helpers.js';

let s: TestServer;
afterEach(() => s?.dispose());

function boot() {
  s = bootServer({ authToken: 'owner-grant-test' });
  s.db
    .insert(pairedDevice)
    .values({
      id: 'paired',
      teamId: s.team.id,
      name: 'test',
      tokenHash: 'synthetic',
      masked: 'test',
      createdAt: 1,
    })
    .run();
  s.db
    .insert(machine)
    .values({
      id: 'grant-machine',
      name: 'orb',
      teamId: s.team.id,
      capabilities: { mcpServers: [], skills: [], computer: true, browser: true },
    })
    .run();
}

function call(
  path: string,
  body: unknown,
  kind: 'owner' | 'device' | 'agent' = 'owner',
  method = 'PATCH',
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
  };
  if (kind === 'agent')
    headers.authorization = `Bearer ${createApiKey(s, { teamId: s.team.id, gitAccess: false, mcpAccess: true, machineAccess: true, toolGrants: { read: [], write: [] } }).plaintext}`;
  else
    headers.cookie = `cairn_auth=${issueBrowserSession(s.db, kind, kind === 'device' ? 'paired' : null).token}`;
  return s.app.request(path, { method, headers, body: JSON.stringify(body) });
}

test('owner patches nullable grants; absent capability rejects atomically and unknown machines are 404', async () => {
  boot();
  const path = '/api/machines/grant-machine';
  expect((await call(path, { browserOverride: false, desktopOverride: false })).status).toBe(200);
  expect(s.db.select().from(machine).where(eq(machine.id, 'grant-machine')).get()).toMatchObject({
    browserOverride: false,
    desktopOverride: false,
  });
  expect(
    await (await call(path, { browserOverride: null, desktopOverride: null })).json(),
  ).toMatchObject({ browserOverride: null, desktopOverride: null });
  s.db.update(machine).set({ capabilities: null }).where(eq(machine.id, 'grant-machine')).run();
  expect((await call(path, { browserOverride: true, desktopOverride: false })).status).toBe(409);
  expect(
    s.db.select().from(machine).where(eq(machine.id, 'grant-machine')).get()?.desktopOverride,
  ).toBeNull();
  expect((await call('/api/machines/missing', { browserOverride: false })).status).toBe(404);
  s.db.insert(team).values({ id: 'foreign', name: 'Foreign', createdAt: 1 }).run();
  s.db.insert(machine).values({ id: 'foreign', teamId: 'foreign', name: 'foreign' }).run();
  expect((await call('/api/machines/foreign', { desktopOverride: false })).status).toBe(404);
});

test('only the owner moves the default Runner, and only to an enrolled machine', async () => {
  boot();
  s.db
    .insert(machine)
    .values({ id: 'enrolled', name: 'mac', teamId: s.team.id, tokenHash: 'synthetic' })
    .run();
  const defaultOf = () =>
    s.db.select().from(team).where(eq(team.id, s.team.id)).get()?.defaultMachineId ?? null;
  expect((await call('/api/machines/enrolled', { isDefault: true }, 'device')).status).toBe(403);
  expect(defaultOf()).toBeNull();
  expect((await call('/api/machines/grant-machine', { isDefault: true })).status).toBe(409);
  expect(defaultOf()).toBeNull();
  expect((await call('/api/machines/enrolled', { isDefault: true })).status).toBe(200);
  expect(defaultOf()).toBe('enrolled');
});

test.each(['device', 'agent'] as const)(
  '%s cannot change machine or mirrored computer grants',
  async (kind) => {
    boot();
    expect(
      (
        await call(
          '/api/machines/grant-machine',
          { browserOverride: false, desktopOverride: false },
          kind,
        )
      ).status,
    ).toBe(kind === 'device' ? 403 : 401);
    expect(
      (
        await call(
          '/api/computers',
          { machineId: 'grant-machine', browserEnabled: true },
          kind,
          'POST',
        )
      ).status,
    ).toBe(kind === 'device' ? 403 : 401);
    expect((await call('/api/computers/missing', { browserEnabled: true }, kind)).status).toBe(
      kind === 'device' ? 403 : 401,
    );
    expect(
      s.db.select().from(machine).where(eq(machine.id, 'grant-machine')).get()?.browserOverride,
    ).toBeNull();
    expect(s.db.select().from(computer).all()).toEqual([]);
  },
);

test('compatibility writes mirror the machine grant and cannot undo explicit off', async () => {
  boot();
  const response = await call(
    '/api/computers',
    { machineId: 'grant-machine', browserEnabled: true },
    'owner',
    'POST',
  );
  const body = (await response.json()) as { computer: { id: string } };
  expect(response.status).toBe(200);
  expect(
    s.db.select().from(machine).where(eq(machine.id, 'grant-machine')).get()?.browserOverride,
  ).toBe(true);
  await call('/api/machines/grant-machine', { browserOverride: false });
  expect((await call(`/api/computers/${body.computer.id}`, { browserEnabled: true })).status).toBe(
    409,
  );
  expect(
    s.db.select().from(machine).where(eq(machine.id, 'grant-machine')).get()?.browserOverride,
  ).toBe(false);
});
