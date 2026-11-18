import { join } from 'node:path';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle, openMemoryDb } from '../src/db/client.js';
import { dataMigration } from '../src/db/schema.js';
import { runDataMigrationOnce } from '../src/services/data-migrations.js';
import { migrateUpTo } from './migrate-helpers.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

function dbPath(prefix: string): { dir: string; path: string } {
  const dir = makeTestTempDir(prefix);
  dirs.push(dir);
  return { dir, path: join(dir, 'server.db') };
}

describe('runDataMigrationOnce', () => {
  test('runs once, records the result in data_migration, and skips later calls', () => {
    const db = openMemoryDb();
    let runs = 0;
    const first = runDataMigrationOnce(db, 'test-backfill', () => ++runs);
    const second = runDataMigrationOnce(db, 'test-backfill', () => ++runs);
    expect(runs).toBe(1);
    expect(first).toBe(1);
    expect(second).toBeUndefined();
    expect(
      db
        .select()
        .from(dataMigration)
        .all()
        .map((row) => [row.id, row.detail]),
    ).toEqual([['test-backfill', '1']]);
  });

  test('a marker written by an earlier open is respected on reopen', () => {
    const { path } = dbPath('data-migration-reopen-');
    const opened = openDbWithHandle(path);
    opened.db.insert(dataMigration).values({ id: 'earlier', doneAt: 1, detail: 'null' }).run();
    opened.close();
    const reopened = openDbWithHandle(path);
    expect(runDataMigrationOnce(reopened.db, 'earlier', () => 7)).toBeUndefined();
    reopened.close();
  });
});

describe('retired agent-layer boot path', () => {
  test('a database past the agent drop opens through a single migrate call', () => {
    const { path } = dbPath('data-migration-fresh-');
    const { close } = openDbWithHandle(path);
    close();
  });

  test('a pre-0119 database with live agent rows fails loudly instead of dropping them', () => {
    const { dir, path } = dbPath('data-migration-ancient-');
    const sqlite = new Database(path);
    try {
      sqlite.pragma('foreign_keys = ON');
      migrateUpTo(sqlite, dir, '0119_agent_layer_backup');
      sqlite.exec(
        "INSERT INTO team (id, name, createdAt) VALUES ('t', 'T', 1);" +
          "INSERT INTO agent (id, teamId, displayName) VALUES ('a', 't', 'Agent')",
      );
    } finally {
      sqlite.close();
    }
    expect(() => openDbWithHandle(path)).toThrow();
  });

  test('a pre-0119 database with an empty agent table drops it and opens', () => {
    const { dir, path } = dbPath('data-migration-empty-agent-');
    const sqlite = new Database(path);
    try {
      sqlite.pragma('foreign_keys = ON');
      migrateUpTo(sqlite, dir, '0119_agent_layer_backup');
    } finally {
      sqlite.close();
    }
    const { db, close } = openDbWithHandle(path);
    expect(
      db
        .all<{ name: string }>(
          sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('agent', 'legacy_agent_backup')`,
        )
        .map((row) => row.name),
    ).toEqual(['legacy_agent_backup']);
    close();
  });
});
