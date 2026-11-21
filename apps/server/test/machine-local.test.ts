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
  test('seed creates a kind=local row named after the host', () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const rows = localRows(s.db, s.team.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('local');
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

  test('an unclaimed row named after the host: seed marks it local, no separate row', async () => {
    const s = bootServer();
    try {
      s.db
        .insert(machineTable)
        .values({ id: 'unclaimed-host-row', teamId: s.team.id, name: HOST, online: false })
        .run();
      seedLocalMachine(s.db, s.team.id);
      const rows = localRows(s.db, s.team.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('local');
    } finally {
      s.dispose();
    }
  });

  test('an enrolled remote row named after the host stays remote across reseeds', async () => {
    const s = bootServer();
    try {
      const key = await issueApiKey(s);
      const res = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key,
        body: { teamId: s.team.id, name: 'drifted-name', cliVersion: '0.1.0' },
      });
      expect(res.status).toBe(200);
      const { machineId } = (await res.json()) as { machineId: string };
      s.db.update(machineTable).set({ name: HOST }).where(eq(machineTable.id, machineId)).run();
      seedLocalMachine(s.db, s.team.id);
      const rows = localRows(s.db, s.team.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('remote');
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
    } finally {
      s.dispose();
    }
  });
});

describe('machine record hostname', () => {
  test('the record carries the hostname the Runner reported, and the seeded local row the server hostname', async () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const key = await issueApiKey(s);
      const enrolled = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key,
        body: {
          teamId: s.team.id,
          name: 'office-runner',
          cliVersion: '0.1.0',
          claudeCode: { installed: true, hostname: 'thinkbox-02', models: [] },
        },
      });
      expect(enrolled.status).toBe(200);
      const legacy = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: await issueApiKey(s),
        body: { teamId: s.team.id, name: 'legacy-runner', cliVersion: '0.1.0' },
      });
      expect(legacy.status).toBe(200);
      const list = (await (
        await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`)
      ).json()) as unknown[];
      const byName = (name: string) =>
        machineRecordSchema.parse(list.find((m) => (m as { name: string }).name === name));
      expect(byName(HOST).hostname).toBe(HOST);
      expect(byName('office-runner').hostname).toBe('thinkbox-02');
      expect(byName('legacy-runner').hostname).toBeUndefined();
    } finally {
      s.dispose();
    }
  });
});

describe('PATCH /api/machines/{id} (runtimes follow detection)', () => {
  test('the record lists what the Runner detects, and a runtime write is refused without touching the row', async () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const id = localRows(s.db, s.team.id)[0]?.id ?? '';
      s.db
        .update(machineTable)
        .set({
          claudeCodeReport: { installed: true, hostname: 'local', models: [] },
        })
        .where(eq(machineTable.id, id))
        .run();
      const list = (await (
        await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`)
      ).json()) as unknown[];
      const record = machineRecordSchema.parse(list.find((m) => (m as { id: string }).id === id));
      expect(record.enabledRuntimes).toEqual(['pi', 'claude-code']);
      for (const enabledRuntimes of [[], ['pi', 'claude-code'], ['pi', 'gemini']]) {
        const res = await req(s.app, 'PATCH', `/api/machines/${id}`, { enabledRuntimes });
        expect(res.status).toBe(409);
        expect(((await res.json()) as { error: string }).error).toMatch(/no runtime switch/);
      }
      const after = (await (
        await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`)
      ).json()) as unknown[];
      expect(
        machineRecordSchema.parse(after.find((m) => (m as { id: string }).id === id))
          .enabledRuntimes,
      ).toEqual(['pi', 'claude-code']);
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
    } finally {
      s.dispose();
    }
  });

  test('a name renames the computer, trimmed, and an empty or control-character name is refused', async () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const id = localRows(s.db, s.team.id)[0]?.id ?? '';
      const renamed = await req(s.app, 'PATCH', `/api/machines/${id}`, {
        name: '  xmon 的 MacBook Pro ',
      });
      expect(renamed.status).toBe(200);
      expect(machineRecordSchema.parse(await renamed.json()).name).toBe('xmon 的 MacBook Pro');
      for (const name of ['   ', 'a\u0007b', 'x'.repeat(65)]) {
        const bad = await req(s.app, 'PATCH', `/api/machines/${id}`, { name });
        expect(bad.status).toBe(400);
      }
      const row = s.db.select().from(machineTable).where(eq(machineTable.id, id)).get();
      expect(row?.name).toBe('xmon 的 MacBook Pro');
    } finally {
      s.dispose();
    }
  });
});
