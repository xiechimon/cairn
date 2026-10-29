import { hostname } from 'node:os';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { machine as machineTable } from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-keys.js';
import { seedLocalMachine } from '../src/services/machines.js';
import { bootServer, issueApiKey, type TestServer } from './helpers.js';

const HOST = hostname();
const OWNER_TOKEN = 'cairn-owner-enroll-2054';

function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

async function ownerClaimLocal(s: TestServer): Promise<{ machineId: string; token: string }> {
  const start = await call(s.app, 'POST', '/api/machine/enroll/start', {
    body: { name: HOST, teamId: s.team.id },
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
