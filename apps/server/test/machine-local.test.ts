import { hostname } from 'node:os';
import { machineRecordSchema } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { machine as machineTable } from '../src/db/schema.js';
import { seedLocalMachine } from '../src/services/machines.js';
import { bootServer, issueApiKey, req } from './helpers.js';

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

function localRows(db: ReturnType<typeof bootServer>['db'], teamId: string) {
  return db
    .select()
    .from(machineTable)
    .where(eq(machineTable.teamId, teamId))
    .all()
    .filter((r) => r.name === HOST);
}

describe('local-machine row seed (spec 11 A8: server boot seed, idempotent)', () => {
  test('seed creates kind=local row (name=os.hostname(), enabledRuntimes default [pi])', () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const rows = localRows(s.db, s.team.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('local');
      expect(rows[0]?.enabledRuntimes).toEqual(['pi']);
    } finally {
      s.dispose();
    }
  });

  test('second seed does not create a duplicate row (acceptance: second server boot)', () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      seedLocalMachine(s.db, s.team.id);
      expect(localRows(s.db, s.team.id)).toHaveLength(1);
    } finally {
      s.dispose();
    }
  });

  test('local-machine row renamed (name drifted from hostname): reseed locates it by kind uniqueness, no duplicate', () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const row = localRows(s.db, s.team.id)[0];
      expect(row).toBeDefined();
      s.db
        .update(machineTable)
        .set({ name: 'renamed-box' })
        .where(eq(machineTable.id, row?.id ?? ''))
        .run();
      seedLocalMachine(s.db, s.team.id);
      const locals = s.db
        .select()
        .from(machineTable)
        .where(and(eq(machineTable.teamId, s.team.id), eq(machineTable.kind, 'local')))
        .all();
      expect(locals).toHaveLength(1);
      expect(locals[0]?.id).toBe(row?.id);
    } finally {
      s.dispose();
    }
  });

  test('an enrolled hostname row without a seed: seed adds kind=local, no separate row', async () => {
    const s = bootServer();
    try {
      const key = await issueApiKey(s);
      const res = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key,
        body: { teamId: s.team.id, name: HOST, cliVersion: '0.1.0' },
      });
      expect(res.status).toBe(200);
      expect(localRows(s.db, s.team.id)[0]?.kind).toBe('local');
      seedLocalMachine(s.db, s.team.id);
      const rows = localRows(s.db, s.team.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('local');
      expect(rows[0]?.tokenHash).not.toBeNull();
    } finally {
      s.dispose();
    }
  });
});

describe('enroll hostname same law (spec 11 A9: loopback enroll lands kind=local)', () => {
  test('owner-approved confirm name=hostname -> kind=local; seed row reused (no duplicate)', async () => {
    const ownerToken = 'cairn-owner-local-a9';
    const s = bootServer({ authToken: ownerToken });
    try {
      seedLocalMachine(s.db, s.team.id);
      const seededId = localRows(s.db, s.team.id)[0]?.id;
      const start = await call(s.app, 'POST', '/api/machine/enroll/start', {
        body: { name: HOST, teamId: s.team.id },
      });
      expect(start.status).toBe(200);
      const { enrollId } = (await start.json()) as { enrollId: string };
      const confirmed = await call(s.app, 'POST', '/api/machine/enroll/confirm', {
        cred: ownerToken,
        body: { enrollId },
      });
      expect(confirmed.status).toBe(200);
      const { machine } = (await confirmed.json()) as { machine: { machineId: string } };
      const rows = localRows(s.db, s.team.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(seededId);
      expect(rows[0]?.id).toBe(machine.machineId);
      expect(rows[0]?.kind).toBe('local');
      expect(rows[0]?.tokenHash).not.toBeNull();
    } finally {
      s.dispose();
    }
  });

  test('enroll with a different-name machine -> kind=remote (default law unbroken)', async () => {
    const s = bootServer();
    try {
      const key = await issueApiKey(s);
      await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key,
        body: { teamId: s.team.id, name: 'lan-box', cliVersion: '0.1.0' },
      });
      const row = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.teamId, s.team.id))
        .all()
        .find((r) => r.name === 'lan-box');
      expect(row?.kind).toBe('remote');
      expect(row?.enabledRuntimes).toEqual(['pi']);
    } finally {
      s.dispose();
    }
  });
});

describe('PATCH /api/machines/{id} (spec 11 A8/A9: enabledRuntimes write-back)', () => {
  test('PATCH succeeds, GET echoes back consistent (acceptance)', async () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const id = localRows(s.db, s.team.id)[0]?.id;
      const res = await req(s.app, 'PATCH', `/api/machines/${id}`, {
        enabledRuntimes: ['pi', 'claude-code'],
      });
      expect(res.status).toBe(200);
      const patched = machineRecordSchema.parse(await res.json());
      expect(patched.enabledRuntimes).toEqual(['pi', 'claude-code']);
      expect(patched.kind).toBe('local');
      const list = (await (
        await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`)
      ).json()) as unknown[];
      const record = machineRecordSchema.parse(list.find((m) => (m as { id: string }).id === id));
      expect(record.enabledRuntimes).toEqual(['pi', 'claude-code']);
      const off = await req(s.app, 'PATCH', `/api/machines/${id}`, { enabledRuntimes: [] });
      expect(off.status).toBe(200);
      expect(localRows(s.db, s.team.id)[0]?.enabledRuntimes).toEqual([]);
    } finally {
      s.dispose();
    }
  });

  test('unknown id -> 404 {error}', async () => {
    const s = bootServer();
    try {
      const res = await req(s.app, 'PATCH', '/api/machines/nope', {
        enabledRuntimes: ['pi'],
      });
      expect(res.status).toBe(404);
      expect(Object.keys((await res.json()) as object)).toEqual(['error']);
    } finally {
      s.dispose();
    }
  });

  test('out-of-vocabulary runtime / wrong-shape body -> 400', async () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const id = localRows(s.db, s.team.id)[0]?.id;
      const bad = await req(s.app, 'PATCH', `/api/machines/${id}`, {
        enabledRuntimes: ['pi', 'codex'],
      });
      expect(bad.status).toBe(400);
      const shape = await req(s.app, 'PATCH', `/api/machines/${id}`, {
        enabledRuntimes: 'pi',
      });
      expect(shape.status).toBe(400);
      expect(localRows(s.db, s.team.id)[0]?.enabledRuntimes).toEqual(['pi']);
    } finally {
      s.dispose();
    }
  });
});
