import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';

const temps: string[] = [];
function temp(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  temps.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function readJournal(folder: string): { entries: { idx: number; tag: string }[] } {
  return JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'));
}

const OVERRIDE_MARKER = /UPDATE `machine` SET `maxConcurrentOverridden`/;

function findBackfillEntry(): { idx: number; tag: string } {
  const entry = readJournal(MIGRATIONS_FOLDER).entries.find((e) =>
    OVERRIDE_MARKER.test(readFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), 'utf8')),
  );
  expect(entry, 'maxConcurrentOverridden backfill migration missing from journal').toBeTruthy();
  return entry!;
}

function preBackfillMigrations(): string {
  const journal = readJournal(MIGRATIONS_FOLDER);
  const backfillIdx = journal.entries.findIndex((e) => e.tag === findBackfillEntry().tag);
  expect(backfillIdx, 'backfill migration should be in the journal').toBeGreaterThan(0);
  const dir = temp('cairn-migrations-pre-concurrency-');
  mkdirSync(join(dir, 'meta'));
  for (const entry of journal.entries.slice(0, backfillIdx)) {
    cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
  }
  const full = readJournal(MIGRATIONS_FOLDER);
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...full, entries: full.entries.slice(0, backfillIdx) }, null, 2),
  );
  return dir;
}

function buildPreBackfillDb(rows: { id: string; maxConcurrent: number }[]): string {
  const dir = temp('cairn-concurrency-db-');
  const dbPath = join(dir, 'server.db');
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: preBackfillMigrations() });
  const { team } = seed(db);
  const insert = sqlite.prepare(
    'INSERT INTO machine (id, teamId, name, maxConcurrent) VALUES (?, ?, ?, ?)',
  );
  for (const row of rows) {
    insert.run(row.id, team.id, `存量-${row.id}`, row.maxConcurrent);
  }
  sqlite.close();
  return dbPath;
}

function readFlags(dbPath: string, id: string): { maxConcurrentOverridden: number } {
  const sqlite = new Database(dbPath, { readonly: true });
  const row = sqlite
    .prepare('SELECT maxConcurrentOverridden FROM machine WHERE id = ?')
    .get(id) as { maxConcurrentOverridden: number };
  sqlite.close();
  return row;
}

describe('#1241 machine concurrency override-bit backfill (legacy user values persist + default rows take the recommendation)', () => {
  test('pre-upgrade legacy db -> backfill rerun: B1 non-default value becomes override, B2 default 3 not overridden', () => {
    const dbPath = buildPreBackfillDb([
      { id: 'cc-user-5', maxConcurrent: 5 },
      { id: 'cc-user-16', maxConcurrent: 16 },
      { id: 'cc-default-3', maxConcurrent: 3 },
    ]);
    const sqlite = new Database(dbPath);
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.close();

    expect(readFlags(dbPath, 'cc-user-5')).toEqual({ maxConcurrentOverridden: 1 });
    expect(readFlags(dbPath, 'cc-user-16')).toEqual({ maxConcurrentOverridden: 1 });
    expect(readFlags(dbPath, 'cc-default-3')).toEqual({ maxConcurrentOverridden: 0 });
  });
});
