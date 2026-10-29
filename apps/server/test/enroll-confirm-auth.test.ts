import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { machine as machineTable } from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { createApiKey } from '../src/services/api-keys.js';
import { bootServer, type TestServer } from './helpers.js';

const OWNER_TOKEN = 'cairn-owner-enroll-confirm-2053';

function reqWith(
  s: TestServer,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(
    s.app.request(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
}

describe('enroll confirm owner auth (#2053)', () => {
  test('anonymous confirmation with auth enabled returns 401', async () => {
    const s = bootServer({ authToken: OWNER_TOKEN });
    const denied = await reqWith(s, 'GET', '/api/projects', {});
    expect(denied.status).toBe(401);

    const start = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/start',
      {},
      { name: 'audit-machine' },
    );
    expect(start.status).toBe(200);
    const { enrollId } = (await start.json()) as { enrollId: string };

    const confirm = await reqWith(s, 'POST', '/api/machine/enroll/confirm', {}, { enrollId });
    expect(confirm.status).toBe(401);

    const poll = await reqWith(s, 'POST', '/api/machine/enroll/poll', {}, { enrollId });
    expect(await poll.json()).toEqual({ status: 'pending' });
  });

  test('wrong bearer and api-key bearer cannot confirm', async () => {
    const s = bootServer({ authToken: OWNER_TOKEN });
    const start = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/start',
      {},
      { name: 'wrong-bearer' },
    );
    const { enrollId } = (await start.json()) as { enrollId: string };
    const apiKey = createApiKey(s, {
      teamId: s.team.id,
      gitAccess: false,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
    }).plaintext;

    const wrong = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/confirm',
      { authorization: 'Bearer not-the-owner-token' },
      { enrollId },
    );
    expect(wrong.status).toBe(401);

    const withKey = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/confirm',
      { authorization: `Bearer ${apiKey}` },
      { enrollId },
    );
    expect(withKey.status).toBe(401);

    const poll = await reqWith(s, 'POST', '/api/machine/enroll/poll', {}, { enrollId });
    expect(await poll.json()).toEqual({ status: 'pending' });
  });

  test('owner confirmation authorizes; CLI poll stays anonymous; confirm is single-use', async () => {
    const s = bootServer({ authToken: OWNER_TOKEN });
    const start = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/start',
      {},
      { name: 'owner-approved', teamId: s.team.id },
    );
    expect(start.status).toBe(200);
    const { enrollId } = (await start.json()) as { enrollId: string };

    const pending = await reqWith(s, 'POST', '/api/machine/enroll/poll', {}, { enrollId });
    expect(await pending.json()).toEqual({ status: 'pending' });

    const confirmed = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/confirm',
      { authorization: `Bearer ${OWNER_TOKEN}` },
      { enrollId },
    );
    expect(confirmed.status).toBe(200);
    const { machine } = (await confirmed.json()) as {
      machine: { machineId: string; token: string; teamId: string };
    };
    expect(machine.teamId).toBe(s.team.id);

    const after = await reqWith(s, 'POST', '/api/machine/enroll/poll', {}, { enrollId });
    expect(await after.json()).toEqual({ status: 'authorized', machine });

    const me = await reqWith(s, 'GET', '/api/machine/me', {
      authorization: `Bearer ${machine.token}`,
    });
    expect(me.status).toBe(200);

    const again = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/confirm',
      { authorization: `Bearer ${OWNER_TOKEN}` },
      { enrollId },
    );
    expect(again.status).toBe(409);

    const row = s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.id, machine.machineId))
      .get();
    expect(row).toMatchObject({ teamId: s.team.id, name: 'owner-approved' });
  });

  test('confirmation rejects enrollment bound to a foreign team', async () => {
    const s = bootServer({ authToken: OWNER_TOKEN });
    const foreignTeamId = newRecordId();
    const start = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/start',
      {},
      { name: 'foreign-team', teamId: foreignTeamId },
    );
    expect(start.status).toBe(200);
    const { enrollId } = (await start.json()) as { enrollId: string };

    const confirm = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/confirm',
      { authorization: `Bearer ${OWNER_TOKEN}` },
      { enrollId },
    );
    expect(confirm.status).toBe(403);

    const poll = await reqWith(s, 'POST', '/api/machine/enroll/poll', {}, { enrollId });
    expect(await poll.json()).toEqual({ status: 'pending' });
  });

  test('auth off still allows confirm without bearer (local/dev)', async () => {
    const s = bootServer();
    const start = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/start',
      {},
      { name: 'dev-machine' },
    );
    const { enrollId } = (await start.json()) as { enrollId: string };
    const confirmed = await reqWith(s, 'POST', '/api/machine/enroll/confirm', {}, { enrollId });
    expect(confirmed.status).toBe(200);
  });

  test('allowlisted loopback Tailscale identity confirms without stored bearer', async () => {
    const s = bootServer({
      authToken: OWNER_TOKEN,
      tailscaleUsers: ['xiechimon@github'],
    });
    const start = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/start',
      {},
      { name: 'tailscale-serve' },
    );
    expect(start.status).toBe(200);
    const { enrollId } = (await start.json()) as { enrollId: string };

    const forged = await Promise.resolve(
      s.app.request(
        '/api/machine/enroll/confirm',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Tailscale-User-Login': 'xiechimon@github',
          },
          body: JSON.stringify({ enrollId }),
        },
        { incoming: { socket: { remoteAddress: '100.64.0.2' } } },
      ),
    );
    expect(forged.status).toBe(401);

    const stranger = await Promise.resolve(
      s.app.request(
        '/api/machine/enroll/confirm',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Tailscale-User-Login': 'stranger@github',
          },
          body: JSON.stringify({ enrollId }),
        },
        { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
      ),
    );
    expect(stranger.status).toBe(401);

    const confirmed = await Promise.resolve(
      s.app.request(
        '/api/machine/enroll/confirm',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Tailscale-User-Login': 'xiechimon@github',
          },
          body: JSON.stringify({ enrollId }),
        },
        { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
      ),
    );
    expect(confirmed.status).toBe(200);
    const { machine } = (await confirmed.json()) as {
      machine: { machineId: string; token: string; teamId: string };
    };
    expect(machine.teamId).toBe(s.team.id);

    const poll = await reqWith(s, 'POST', '/api/machine/enroll/poll', {}, { enrollId });
    expect(await poll.json()).toEqual({ status: 'authorized', machine });
  });
});
