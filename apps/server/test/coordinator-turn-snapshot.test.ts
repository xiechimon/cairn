import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { type Db, MIGRATIONS_FOLDER, openMemoryDb } from '../src/db/client.js';
import { team } from '../src/db/schema.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer } from './helpers.js';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

const DAY = 86_400_000;

function world() {
  const db = openMemoryDb();
  db.insert(team)
    .values([
      { id: 'a', name: 'A', createdAt: 0 },
      { id: 'b', name: 'B', createdAt: 0 },
    ])
    .run();
  return db;
}

function put(db: Db, id: string, capturedAt = 1, teamId = 'a', payload = '{}') {
  db.run(sql`INSERT INTO coordinator_turn_snapshot
    (turnId, teamId, sourceTraceId, schemaVersion, outcome, capturedAt, expiresAt,
     status, reason, redactionCount, payloadBytes, digest, payload)
    VALUES (${id}, ${teamId}, ${id.padEnd(32, '0')}, 1, 'success', ${capturedAt}, ${capturedAt + 30 * DAY},
      'sealed', NULL, 0, ${Buffer.byteLength(payload)},
      ${'a'.repeat(64)}, ${payload})`);
}

function ids(db: Db) {
  return db
    .all<{ turnId: string }>(sql`SELECT turnId FROM coordinator_turn_snapshot ORDER BY turnId`)
    .map((row) => row.turnId);
}

test('snapshot upgrade keeps payloads readable by both releases and removes the old GC event', () => {
  const directory = makeTestTempDir('snapshot-upgrade-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, '0144_github_label_isolation');
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('a', 'A', 0)");
    sqlite.exec("INSERT INTO project (id, teamId, name) VALUES ('p', 'a', 'Before')");
    migrateUpTo(sqlite, directory, '0145_coordinator_turn_snapshot');
    sqlite.exec(`INSERT INTO coordinator_turn_snapshot
      (turnId, teamId, sourceTraceId, schemaVersion, outcome, capturedAt, expiresAt,
       status, reason, redactionCount, payloadBytes, digest, payload)
      VALUES ('s', 'a', '${'1'.repeat(32)}', 1, 'success', 1, ${1 + 30 * DAY},
        'sealed', NULL, 0, 17, '${'a'.repeat(64)}', '{"name":"Before"}')`);
    sqlite.exec(`INSERT INTO due_event (id, kind, dueAt, intervalMs, attempts, lastError)
      VALUES ('gc:coordinator-snapshots', 'coordinator-snapshot-gc', 0, ${DAY}, 0, NULL)`);
    migrateAll(sqlite);
    sqlite.exec("UPDATE project SET name = 'After' WHERE id = 'p'; DELETE FROM project");
    expect(
      sqlite.prepare('SELECT payload, expiresAt FROM coordinator_turn_snapshot').get(),
    ).toEqual({
      payload: '{"name":"Before"}',
      expiresAt: 1 + 30 * DAY,
    });
    expect(
      sqlite
        .prepare(`EXPLAIN QUERY PLAN SELECT id FROM chief_message
        INDEXED BY chief_message_thread_insert_idx WHERE threadId = 't' AND rowid > 100 LIMIT 1`)
        .all(),
    ).toEqual([
      expect.objectContaining({ detail: expect.stringContaining('threadId=? AND rowid>?') }),
    ]);
    expect(
      sqlite.prepare("SELECT id FROM due_event WHERE id = 'gc:coordinator-snapshots'").get(),
    ).toBeUndefined();
    const { entries } = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
    );
    const at = entries.findIndex((entry: { tag: string }) =>
      entry.tag.endsWith('_coordinator_turn_snapshot'),
    );
    expect(at).toBeGreaterThan(0);
    expect(entries[at].idx).toBe(entries[at - 1].idx + 1);
    expect(entries[at].when).toBeGreaterThan(
      Math.max(...entries.slice(0, at).map((entry: { when: number }) => entry.when)),
    );
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('turn and trace identities are independently unique', () => {
  const db = world();
  put(db, 'one');
  expect(() => put(db, 'one')).toThrow(
    expect.objectContaining({
      cause: expect.objectContaining({
        code: expect.stringMatching(/^SQLITE_CONSTRAINT_(UNIQUE|PRIMARYKEY)$/),
      }),
    }),
  );
  expect(() =>
    db.run(sql`INSERT INTO coordinator_turn_snapshot
    SELECT 'two', teamId, sourceTraceId, schemaVersion, outcome, capturedAt, expiresAt,
      status, reason, redactionCount, payloadBytes, digest, payload FROM coordinator_turn_snapshot`),
  ).toThrow(
    expect.objectContaining({
      cause: expect.objectContaining({
        code: expect.stringMatching(/^SQLITE_CONSTRAINT_(UNIQUE|PRIMARYKEY)$/),
      }),
    }),
  );
  expect(ids(db)).toEqual(['one']);
});

test('storage rejects oversized UTF-8 payloads, invalid envelopes and inconsistent byte counts', () => {
  const db = world();
  expect(() => put(db, 'big', 1, 'a', JSON.stringify('界'.repeat(700_000)))).toThrow(
    expect.objectContaining({
      cause: expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }),
    }),
  );
  put(db, 'valid');
  for (const assignment of [
    "status = 'collecting'",
    "outcome = 'pending'",
    'schemaVersion = 0',
    'redactionCount = -1',
    'payloadBytes = 1',
    "digest = 'bad'",
    'payload = NULL',
    "status = 'unusable'",
    'expiresAt = capturedAt',
  ]) {
    expect(
      () => db.run(sql.raw(`UPDATE coordinator_turn_snapshot SET ${assignment}`)),
      assignment,
    ).toThrow(
      expect.objectContaining({
        cause: expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }),
      }),
    );
  }
  expect(ids(db)).toEqual(['valid']);
});

test('unusable rows retain only bounded reason metadata and no payload', () => {
  const db = world();
  put(db, 'valid');
  db.run(sql`UPDATE coordinator_turn_snapshot SET status = 'unusable', reason = 'missing_capture',
    payload = NULL, payloadBytes = 0, digest = NULL`);
  expect(db.get(sql`SELECT status, payload, digest FROM coordinator_turn_snapshot`)).toEqual({
    status: 'unusable',
    payload: null,
    digest: null,
  });
  expect(() =>
    db.run(sql`UPDATE coordinator_turn_snapshot SET reason = ${'x'.repeat(129)}`),
  ).toThrow(
    expect.objectContaining({
      cause: expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }),
    }),
  );
});

test('team deletion cascades snapshots without deleting another team history', () => {
  const db = world();
  put(db, 'a-turn');
  put(db, 'b-turn', 1, 'b');
  db.run(sql`DELETE FROM team WHERE id = 'a'`);
  expect(ids(db)).toEqual(['b-turn']);
});

test('snapshots survive a scheduler run at 256 MiB and 30 days', async () => {
  const server = bootServer();
  const payload = JSON.stringify('x'.repeat(2 * 1024 * 1024 - 2));
  const now = 3650 * DAY;
  server.db.transaction(() => {
    for (let i = 0; i < 129; i++)
      put(server.db, `cap-${String(i).padStart(3, '0')}`, now - DAY, server.team.id, payload);
    put(server.db, 'ancient', 1, server.team.id);
  });
  let callback: (() => void | Promise<void>) | undefined;
  const scheduler = createScheduler(server.svc, {
    tickMs: DAY,
    clock: {
      now: () => now,
      setTimer: (cb) => {
        callback = cb;
        return cb;
      },
      clearTimer: () => {},
    },
  });
  try {
    scheduler.start();
    expect(
      server.db.get(sql`SELECT id FROM due_event WHERE kind = 'coordinator-snapshot-gc'`),
    ).toBeUndefined();
    expect(callback).toBeDefined();
    await callback?.();
    expect(ids(server.db)).toHaveLength(130);
    expect(ids(server.db)).toContain('ancient');
    expect(ids(server.db)).toContain('cap-000');
    expect(
      server.db.get(
        sql`SELECT sum(payloadBytes) AS bytes FROM coordinator_turn_snapshot WHERE teamId = ${server.team.id} AND turnId LIKE 'cap-%'`,
      ),
    ).toEqual({ bytes: 129 * Buffer.byteLength(payload) });
    scheduler.stop();
    scheduler.start();
    expect(
      server.db.get(sql`SELECT id FROM due_event WHERE kind = 'coordinator-snapshot-gc'`),
    ).toBeUndefined();
    expect(ids(server.db)).toHaveLength(130);
  } finally {
    scheduler.stop();
  }
});

test('scheduler never registers snapshot cleanup and old snapshots survive every due callback', async () => {
  const server = bootServer();
  let callback: (() => void | Promise<void>) | undefined;
  const now = 3650 * DAY;
  const scheduler = createScheduler(server.svc, {
    tickMs: DAY,
    clock: {
      now: () => now,
      setTimer: (cb) => {
        callback = cb;
        return cb;
      },
      clearTimer: () => {},
    },
  });
  put(server.db, 'old', 1, server.team.id);
  try {
    scheduler.start();
    expect(
      server.db.get(sql`SELECT id FROM due_event WHERE kind = 'coordinator-snapshot-gc'`),
    ).toBeUndefined();
    await callback?.();
    expect(ids(server.db)).toEqual(['old']);
    scheduler.stop();
    server.db.run(sql`INSERT INTO due_event (id, kind, dueAt, intervalMs)
      VALUES ('gc:coordinator-snapshots', 'coordinator-snapshot-gc', ${now}, ${DAY})`);
    scheduler.start();
    expect(
      server.db.get(sql`SELECT id FROM due_event WHERE kind = 'coordinator-snapshot-gc'`),
    ).toBeUndefined();
    expect(ids(server.db)).toEqual(['old']);
  } finally {
    scheduler.stop();
  }
});
