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
    const { enrollId, code } = (await start.json()) as { enrollId: string; code: string };

    const confirm = await reqWith(s, 'POST', '/api/machine/enroll/confirm', {}, { enrollId });
    expect(confirm.status).toBe(401);

    const poll = await reqWith(s, 'POST', '/api/machine/enroll/poll', {}, { enrollId });
    expect(await poll.json()).toEqual({ status: 'pending', name: 'audit-machine', code });
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
    const { enrollId, code } = (await start.json()) as { enrollId: string; code: string };
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
    expect(await poll.json()).toEqual({ status: 'pending', name: 'wrong-bearer', code });
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
    const { enrollId, code, pollSecret } = (await start.json()) as {
      enrollId: string;
      code: string;
      pollSecret: string;
    };

    const pending = await reqWith(s, 'POST', '/api/machine/enroll/poll', {}, { enrollId });
    expect(await pending.json()).toEqual({ status: 'pending', name: 'owner-approved', code });

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

    const after = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/poll',
      {},
      { enrollId, pollSecret },
    );
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
    const { enrollId, code } = (await start.json()) as { enrollId: string; code: string };

    const confirm = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/confirm',
      { authorization: `Bearer ${OWNER_TOKEN}` },
      { enrollId },
    );
    expect(confirm.status).toBe(403);

    const poll = await reqWith(s, 'POST', '/api/machine/enroll/poll', {}, { enrollId });
    expect(await poll.json()).toEqual({ status: 'pending', name: 'foreign-team', code });
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

  test('the owner approves with the code the terminal shows; a stranger or a wrong code cannot', async () => {
    const s = bootServer({ authToken: OWNER_TOKEN });
    const start = await reqWith(s, 'POST', '/api/machine/enroll/start', {}, { name: 'studio-mac' });
    const { enrollId, code } = (await start.json()) as { enrollId: string; code: string };
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const decoy = await reqWith(s, 'POST', '/api/machine/enroll/start', {}, { name: 'studio-mac' });
    const { enrollId: decoyId, code: decoyCode } = (await decoy.json()) as {
      enrollId: string;
      code: string;
    };

    expect((await reqWith(s, 'POST', '/api/machine/enroll/confirm', {}, { code })).status).toBe(
      401,
    );
    const wrong = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/confirm',
      { authorization: `Bearer ${OWNER_TOKEN}` },
      { code: 'ZZZZ-ZZZZ' },
    );
    expect(wrong.status).toBe(404);

    const typed = code.toLowerCase().replace('-', ' ');
    const confirmed = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/confirm',
      { authorization: `Bearer ${OWNER_TOKEN}` },
      { code: typed },
    );
    expect(confirmed.status).toBe(200);
    const poll = await reqWith(s, 'POST', '/api/machine/enroll/poll', {}, { enrollId });
    expect(((await poll.json()) as { status: string }).status).toBe('authorized');
    const decoyPoll = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/poll',
      {},
      { enrollId: decoyId },
    );
    expect(await decoyPoll.json()).toEqual({
      status: 'pending',
      name: 'studio-mac',
      code: decoyCode,
    });

    const again = await reqWith(
      s,
      'POST',
      '/api/machine/enroll/confirm',
      { authorization: `Bearer ${OWNER_TOKEN}` },
      { code },
    );
    expect(again.status).toBe(409);
    expect(
      (
        await reqWith(s, 'GET', `/api/teams/${s.team.id}/machine-enrollments`, {
          authorization: `Bearer ${OWNER_TOKEN}`,
        })
      ).status,
    ).toBe(404);
  });
});
