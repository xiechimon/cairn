import { hostname } from 'node:os';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { machine as machineTable } from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-keys.js';
import { seedLocalMachine } from '../src/services/machines.js';
import { bootServer, issueApiKey } from './helpers.js';

const HOST = hostname();

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

  test('machineAccess bootstrap key enrolls and can claim the seeded local row', async () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const key = await issueApiKey(s);
      const response = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key,
        body: { teamId: s.team.id, name: HOST, cliVersion: '0.1.0' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { token: string; machineId: string };
      const me = await call(s.app, 'GET', '/api/machine/me', { cred: body.token });
      expect(me.status).toBe(200);
      expect(((await me.json()) as { kind: string }).kind).toBe('local');
      const locals = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.teamId, s.team.id))
        .all()
        .filter((row) => row.kind === 'local');
      expect(locals).toHaveLength(1);
      expect(locals[0]?.id).toBe(body.machineId);
      expect(locals[0]?.tokenHash).not.toBeNull();
    } finally {
      s.dispose();
    }
  });

  test('another machineAccess key cannot rotate a claimed local token by matching hostname', async () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const firstKey = await issueApiKey(s);
      const first = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: firstKey,
        body: { teamId: s.team.id, name: HOST, cliVersion: '0.1.0' },
      });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as { token: string; machineId: string };
      const before = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.id, firstBody.machineId))
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
        .where(eq(machineTable.id, firstBody.machineId))
        .get();
      expect(after?.tokenHash).toBe(before?.tokenHash);
      expect(after?.apiKeyId).toBe(before?.apiKeyId);

      const me = await call(s.app, 'GET', '/api/machine/me', { cred: firstBody.token });
      expect(me.status).toBe(200);
      expect(((await me.json()) as { id: string }).id).toBe(firstBody.machineId);
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
