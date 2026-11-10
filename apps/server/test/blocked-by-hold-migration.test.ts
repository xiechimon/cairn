import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

test('blocked-by migration upgrades main without changing schema or unrelated holds', () => {
  const directory = makeTestTempDir('cairn-blocked-by-upgrade-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string; when: number }[] };
    const index = journal.entries.findIndex((entry) => entry.tag.endsWith('_blocked_by_hold'));
    const migration = journal.entries[index];
    const previous = journal.entries[index - 1];
    if (migration === undefined || previous === undefined) throw new Error('Missing predecessor');
    expect(migration.idx).toBe(previous.idx + 1);
    expect(migration.when).toBeGreaterThan(
      Math.max(...journal.entries.slice(0, index).map((entry) => entry.when)),
    );
    migrateUpTo(sqlite, directory, previous.tag);
    const schema = sqlite.prepare('SELECT sql FROM sqlite_master ORDER BY name').all();
    const insert = sqlite.prepare(
      'INSERT INTO step (id, buildId, kind, status, createdAt, holdReason, holdUntil) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run('pending', 'build', 'session', 'pending', 1, 'research-before-plan', 100);
    insert.run('quota-waiting', 'build', 'plan', 'waiting_quota', 1, 'research-before-plan', 200);
    insert.run('unrelated', 'build', 'session', 'pending', 1, 'quota', 300);
    migrateUpTo(sqlite, directory, migration.tag);
    expect(sqlite.prepare('SELECT sql FROM sqlite_master ORDER BY name').all()).toEqual(schema);
    expect(
      sqlite.prepare('SELECT id, status, holdReason, holdUntil FROM step ORDER BY id').all(),
    ).toEqual([
      { id: 'pending', status: 'pending', holdReason: 'blocked-by', holdUntil: 100 },
      { id: 'quota-waiting', status: 'waiting_quota', holdReason: 'blocked-by', holdUntil: 200 },
      { id: 'unrelated', status: 'pending', holdReason: 'quota', holdUntil: 300 },
    ]);
    migrateAll(sqlite);
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM step WHERE holdReason = 'blocked-by'").get(),
    ).toEqual({ count: 2 });
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
