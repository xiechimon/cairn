import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import { machine, pairedDevice, team } from '../src/db/schema.js';
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
    headers.cookie = `cairn_auth=${issueBrowserSession(s.db, kind, kind === 'device' ? 'paired' : null, null).token}`;
  return s.app.request(path, { method, headers, body: JSON.stringify(body) });
}

test('owner and paired devices move the default Runner, and only to an enrolled machine', async () => {
  boot();
  s.db
    .insert(machine)
    .values({ id: 'enrolled', name: 'mac', teamId: s.team.id, tokenHash: 'synthetic' })
    .run();
  const defaultOf = () =>
    s.db.select().from(team).where(eq(team.id, s.team.id)).get()?.defaultMachineId ?? null;
  expect((await call('/api/machines/enrolled', { isDefault: true }, 'agent')).status).toBe(401);
  expect(defaultOf()).toBeNull();
  expect((await call('/api/machines/grant-machine', { isDefault: true }, 'device')).status).toBe(
    409,
  );
  expect(defaultOf()).toBeNull();
  expect((await call('/api/machines/enrolled', { isDefault: true }, 'device')).status).toBe(200);
  expect(defaultOf()).toBe('enrolled');
  expect((await call('/api/machines/grant-machine', { isDefault: true })).status).toBe(409);
  expect((await call('/api/machines/enrolled', { isDefault: true })).status).toBe(200);
  expect(defaultOf()).toBe('enrolled');
});
