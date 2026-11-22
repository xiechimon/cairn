import { hostname } from 'node:os';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { machine as machineTable, pairedDevice } from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-keys.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { seedLocalMachine } from '../src/services/machines.js';
import { bootServer, issueApiKey, type TestServer } from './helpers.js';

const HOST = hostname();
const OWNER_TOKEN = 'cairn-owner-enroll-2054';
const HOST_KEY = 'a'.repeat(64);

function machineRow(s: TestServer, id: string) {
  return s.db.select().from(machineTable).where(eq(machineTable.id, id)).get();
}

function enrollKey(s: TestServer, name: string) {
  return createApiKey(s, {
    teamId: s.team.id,
    name,
    gitAccess: false,
    mcpAccess: false,
    machineAccess: true,
    toolGrants: { read: [], write: [] },
  });
}

function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown; peer?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(
      path,
      {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      },
      opts.peer === undefined ? undefined : { incoming: { socket: { remoteAddress: opts.peer } } },
    ),
  );
}

async function ownerClaimLocal(s: TestServer): Promise<{ machineId: string; token: string }> {
  const start = await call(s.app, 'POST', '/api/machine/enroll/start', {
    body: { name: HOST, teamId: s.team.id },
    peer: '127.0.0.1',
  });
  expect(start.status).toBe(200);
  const { enrollId } = (await start.json()) as { enrollId: string };
  const confirmed = await call(s.app, 'POST', '/api/machine/enroll/confirm', {
    cred: OWNER_TOKEN,
    body: { enrollId },
  });
  expect(confirmed.status).toBe(200);
  const { machine } = (await confirmed.json()) as {
    machine: { machineId: string; token: string };
  };
  return machine;
}

describe('machine enrollment authority (#2054)', () => {
  test('restricted MCP key without machineAccess is refused at enroll', async () => {
    const s = bootServer({ authToken: 'synthetic-owner-token' });
    try {
      seedLocalMachine(s.db, s.team.id);
      const key = createApiKey(s, {
        teamId: s.team.id,
        gitAccess: false,
        mcpAccess: true,
        machineAccess: false,
        toolGrants: { read: ['Todos'], write: [] },
      });
      const response = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key.plaintext,
        body: { teamId: s.team.id, name: HOST },
      });
      expect(response.status).toBe(403);
      const local = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.teamId, s.team.id))
        .all()
        .find((row) => row.kind === 'local');
      expect(local?.tokenHash).toBeNull();
      expect(local?.apiKeyId).toBeNull();
    } finally {
      s.dispose();
    }
  });

  test('remote machineAccess key cannot claim the unclaimed local row by hostname', async () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const before = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.teamId, s.team.id))
        .all()
        .find((row) => row.kind === 'local');
      expect(before?.tokenHash).toBeNull();
      expect(before?.apiKeyId).toBeNull();
      const seededId = before?.id;

      const key = createApiKey(s, {
        teamId: s.team.id,
        name: 'remote-enroll',
        gitAccess: false,
        mcpAccess: false,
        machineAccess: true,
        toolGrants: { read: [], write: [] },
      });
      const response = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key.plaintext,
        body: { teamId: s.team.id, name: HOST, cliVersion: '0.1.0' },
      });
      expect(response.status).toBe(403);

      const after = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.id, seededId ?? ''))
        .get();
      expect(after?.tokenHash).toBeNull();
      expect(after?.apiKeyId).toBeNull();
      expect(after?.kind).toBe('local');
    } finally {
      s.dispose();
    }
  });

  test('owner-approved confirm claims the seeded local row; API-key hostname enroll still cannot', async () => {
    const s = bootServer({ authToken: OWNER_TOKEN });
    try {
      seedLocalMachine(s.db, s.team.id);
      const claimed = await ownerClaimLocal(s);
      const me = await call(s.app, 'GET', '/api/machine/me', { cred: claimed.token });
      expect(me.status).toBe(200);
      expect(((await me.json()) as { kind: string }).kind).toBe('local');
      const locals = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.teamId, s.team.id))
        .all()
        .filter((row) => row.kind === 'local');
      expect(locals).toHaveLength(1);
      expect(locals[0]?.id).toBe(claimed.machineId);
      expect(locals[0]?.tokenHash).not.toBeNull();

      const key = createApiKey(s, {
        teamId: s.team.id,
        name: 'post-claim-enroll',
        gitAccess: false,
        mcpAccess: false,
        machineAccess: true,
        toolGrants: { read: [], write: [] },
      });
      const takeover = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key.plaintext,
        body: { teamId: s.team.id, name: HOST, cliVersion: '0.1.0' },
      });
      expect(takeover.status).toBe(403);
      const after = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.id, claimed.machineId))
        .get();
      expect(after?.tokenHash).not.toBeNull();
      expect((await call(s.app, 'GET', '/api/machine/me', { cred: claimed.token })).status).toBe(
        200,
      );
    } finally {
      s.dispose();
    }
  });

  test('another machineAccess key cannot rotate a claimed local token by matching hostname', async () => {
    const s = bootServer({ authToken: OWNER_TOKEN });
    try {
      seedLocalMachine(s.db, s.team.id);
      const first = await ownerClaimLocal(s);
      const before = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.id, first.machineId))
        .get();
      expect(before?.tokenHash).toBeTruthy();

      const secondKey = createApiKey(s, {
        teamId: s.team.id,
        name: 'other-bootstrap',
        gitAccess: false,
        mcpAccess: false,
        machineAccess: true,
        toolGrants: { read: [], write: [] },
      });
      const takeover = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: secondKey.plaintext,
        body: { teamId: s.team.id, name: HOST, cliVersion: '0.1.0' },
      });
      expect(takeover.status).toBe(403);

      const after = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.id, first.machineId))
        .get();
      expect(after?.tokenHash).toBe(before?.tokenHash);
      expect(after?.apiKeyId).toBe(before?.apiKeyId);

      const me = await call(s.app, 'GET', '/api/machine/me', { cred: first.token });
      expect(me.status).toBe(200);
      expect(((await me.json()) as { id: string }).id).toBe(first.machineId);
    } finally {
      s.dispose();
    }
  });

  test('an api key cannot re-enroll a local row it is bound to', async () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const local = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.teamId, s.team.id))
        .all()
        .find((row) => row.kind === 'local');
      const key = createApiKey(s, {
        teamId: s.team.id,
        name: 'legacy-local-key',
        gitAccess: false,
        mcpAccess: false,
        machineAccess: true,
        toolGrants: { read: [], write: [] },
      });
      s.db
        .update(machineTable)
        .set({ apiKeyId: key.id, tokenHash: 'legacy-hash' })
        .where(eq(machineTable.id, local?.id ?? ''))
        .run();

      const response = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key.plaintext,
        body: { teamId: s.team.id, name: 'renamed-away', cliVersion: '0.1.0' },
      });
      expect(response.status).toBe(403);
      const after = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.id, local?.id ?? ''))
        .get();
      expect(after?.tokenHash).toBe('legacy-hash');
      expect(after?.name).toBe(HOST);
    } finally {
      s.dispose();
    }
  });

  test('a machineAccess key cannot mint kind=local once the seeded row is gone', async () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const seeded = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.teamId, s.team.id))
        .all()
        .find((row) => row.kind === 'local');
      expect(seeded).toBeDefined();
      s.db
        .delete(machineTable)
        .where(eq(machineTable.id, seeded?.id ?? ''))
        .run();

      const key = createApiKey(s, {
        teamId: s.team.id,
        name: 'post-delete-enroll',
        gitAccess: false,
        mcpAccess: false,
        machineAccess: true,
        toolGrants: { read: [], write: [] },
      });
      const response = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key.plaintext,
        body: { teamId: s.team.id, name: HOST, cliVersion: '0.1.0' },
      });
      expect(response.status).toBe(403);
      expect(
        s.db
          .select()
          .from(machineTable)
          .where(eq(machineTable.teamId, s.team.id))
          .all()
          .filter((row) => row.kind === 'local'),
      ).toHaveLength(0);
    } finally {
      s.dispose();
    }
  });

  test('another machineAccess key cannot adopt a remote machine by its hostKey', async () => {
    const s = bootServer();
    try {
      const victimKey = enrollKey(s, 'victim-enroll');
      const enrolled = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: victimKey.plaintext,
        body: { teamId: s.team.id, name: 'victim-runner', hostKey: HOST_KEY },
      });
      expect(enrolled.status).toBe(200);
      const victim = (await enrolled.json()) as { machineId: string; token: string };
      const before = machineRow(s, victim.machineId);

      const attackerKey = enrollKey(s, 'other-enroll');
      const takeover = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: attackerKey.plaintext,
        body: { teamId: s.team.id, name: 'lookalike', hostKey: HOST_KEY },
      });
      expect(takeover.status).toBe(403);
      const after = machineRow(s, victim.machineId);
      expect(after?.tokenHash).toBe(before?.tokenHash);
      expect(after?.apiKeyId).toBe(victimKey.id);
      expect((await call(s.app, 'GET', '/api/machine/me', { cred: victim.token })).status).toBe(
        200,
      );
    } finally {
      s.dispose();
    }
  });

  test('an api key cannot adopt a browser-enrolled machine by its hostKey', async () => {
    const s = bootServer({ authToken: OWNER_TOKEN });
    try {
      const start = await call(s.app, 'POST', '/api/machine/enroll/start', {
        body: { teamId: s.team.id, name: 'desk-box', hostKey: HOST_KEY },
        peer: '127.0.0.1',
      });
      expect(start.status).toBe(200);
      const { enrollId } = (await start.json()) as { enrollId: string };
      const confirmed = await call(s.app, 'POST', '/api/machine/enroll/confirm', {
        cred: OWNER_TOKEN,
        body: { enrollId },
      });
      expect(confirmed.status).toBe(200);
      const { machine: enrolled } = (await confirmed.json()) as {
        machine: { machineId: string; token: string };
      };
      const before = machineRow(s, enrolled.machineId);
      expect(before?.apiKeyId).toBeNull();

      const key = enrollKey(s, 'key-claim');
      const takeover = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key.plaintext,
        body: { teamId: s.team.id, name: 'key-claim', hostKey: HOST_KEY },
      });
      expect(takeover.status).toBe(403);
      expect(machineRow(s, enrolled.machineId)?.tokenHash).toBe(before?.tokenHash);
      expect((await call(s.app, 'GET', '/api/machine/me', { cred: enrolled.token })).status).toBe(
        200,
      );
    } finally {
      s.dispose();
    }
  });

  test('same key re-enroll keeps the machine identity through its hostKey', async () => {
    const s = bootServer();
    try {
      const key = enrollKey(s, 'repeat-enroll');
      const first = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key.plaintext,
        body: { teamId: s.team.id, name: 'lan-box', hostKey: HOST_KEY },
      });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as { token: string; machineId: string };
      const second = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key.plaintext,
        body: { teamId: s.team.id, name: 'lan-box-renamed', hostKey: HOST_KEY },
      });
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as { token: string; machineId: string };
      expect(secondBody.machineId).toBe(firstBody.machineId);
      expect(secondBody.token).not.toBe(firstBody.token);
    } finally {
      s.dispose();
    }
  });

  test('a revoked machine cannot re-register through the api-key path', async () => {
    const s = bootServer();
    try {
      const key = enrollKey(s, 'revoked-enroll');
      const enrolled = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key.plaintext,
        body: { teamId: s.team.id, name: 'victim-runner', hostKey: HOST_KEY },
      });
      expect(enrolled.status).toBe(200);
      const victim = (await enrolled.json()) as { machineId: string; token: string };
      s.db
        .update(machineTable)
        .set({ tokenHash: null, retiredAt: Date.now() })
        .where(eq(machineTable.id, victim.machineId))
        .run();

      const again = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key.plaintext,
        body: { teamId: s.team.id, name: 'victim-runner', hostKey: HOST_KEY },
      });
      expect(again.status).toBe(403);
      const after = machineRow(s, victim.machineId);
      expect(after?.tokenHash).toBeNull();
      expect(after?.retiredAt).not.toBeNull();
    } finally {
      s.dispose();
    }
  });

  test('a revoked machine cannot re-register by api key alone', async () => {
    const s = bootServer();
    try {
      const key = enrollKey(s, 'revoked-key-enroll');
      const enrolled = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key.plaintext,
        body: { teamId: s.team.id, name: 'key-runner' },
      });
      expect(enrolled.status).toBe(200);
      const victim = (await enrolled.json()) as { machineId: string };
      s.db
        .update(machineTable)
        .set({ tokenHash: null, retiredAt: Date.now() })
        .where(eq(machineTable.id, victim.machineId))
        .run();

      const again = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key.plaintext,
        body: { teamId: s.team.id, name: 'key-runner' },
      });
      expect(again.status).toBe(403);
      const after = machineRow(s, victim.machineId);
      expect(after?.tokenHash).toBeNull();
      expect(after?.retiredAt).not.toBeNull();
    } finally {
      s.dispose();
    }
  });

  test('a paired-device confirm cannot resurrect a revoked machine, an owner confirm can', async () => {
    const s = bootServer({ authToken: OWNER_TOKEN });
    try {
      s.db
        .insert(pairedDevice)
        .values({
          id: 'paired-enroll',
          teamId: s.team.id,
          name: 'phone',
          tokenHash: 'synthetic',
          masked: 'test',
          createdAt: 1,
        })
        .run();
      const key = enrollKey(s, 'enroll-then-revoke');
      const enrolled = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key.plaintext,
        body: { teamId: s.team.id, name: 'revoked-runner', hostKey: HOST_KEY },
      });
      expect(enrolled.status).toBe(200);
      const victim = (await enrolled.json()) as { machineId: string };
      s.db
        .update(machineTable)
        .set({ tokenHash: null, retiredAt: Date.now() })
        .where(eq(machineTable.id, victim.machineId))
        .run();

      const deviceSession = issueBrowserSession(s.db, 'device', 'paired-enroll');
      const deviceConfirm = (enrollId: string) =>
        s.app.request('/api/machine/enroll/confirm', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `cairn_auth=${deviceSession.token}`,
            'sec-fetch-site': 'same-origin',
          },
          body: JSON.stringify({ enrollId }),
        });
      const start = () =>
        call(s.app, 'POST', '/api/machine/enroll/start', {
          body: { teamId: s.team.id, name: 'revoked-runner', hostKey: HOST_KEY },
          peer: '127.0.0.1',
        });

      const firstStart = await start();
      expect(firstStart.status).toBe(200);
      const { enrollId: deviceEnrollId } = (await firstStart.json()) as { enrollId: string };
      const denied = await deviceConfirm(deviceEnrollId);
      expect(denied.status).toBe(403);
      const afterDeny = machineRow(s, victim.machineId);
      expect(afterDeny?.tokenHash).toBeNull();
      expect(afterDeny?.retiredAt).not.toBeNull();

      const secondStart = await start();
      expect(secondStart.status).toBe(200);
      const { enrollId: ownerEnrollId } = (await secondStart.json()) as { enrollId: string };
      const allowed = await call(s.app, 'POST', '/api/machine/enroll/confirm', {
        cred: OWNER_TOKEN,
        body: { enrollId: ownerEnrollId },
      });
      expect(allowed.status).toBe(200);
      const afterOwner = machineRow(s, victim.machineId);
      expect(afterOwner?.tokenHash).not.toBeNull();
      expect(afterOwner?.retiredAt).toBeNull();
    } finally {
      s.dispose();
    }
  });

  test('same key re-enroll rotates its own machine token', async () => {
    const s = bootServer();
    try {
      const key = await issueApiKey(s);
      const first = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key,
        body: { teamId: s.team.id, name: 'lan-box', cliVersion: '0.1.0' },
      });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as { token: string; machineId: string };
      const second = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key,
        body: { teamId: s.team.id, name: 'lan-box', cliVersion: '0.1.1' },
      });
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as { token: string; machineId: string };
      expect(secondBody.machineId).toBe(firstBody.machineId);
      expect(secondBody.token).not.toBe(firstBody.token);
      expect((await call(s.app, 'GET', '/api/machine/me', { cred: firstBody.token })).status).toBe(
        401,
      );
      expect((await call(s.app, 'GET', '/api/machine/me', { cred: secondBody.token })).status).toBe(
        200,
      );
    } finally {
      s.dispose();
    }
  });
});
