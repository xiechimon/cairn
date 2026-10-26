import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, describe, expect, test } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';

const temps: string[] = [];
function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function readJournal(folder: string): { entries: { idx: number; tag: string }[] } {
  return JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'));
}

function preBackfillMigrations(): string {
  const journal = readJournal(MIGRATIONS_FOLDER);
  const backfillIdx = journal.entries.findIndex((entry) =>
    /json_insert\(`?tools`?.*'推送分支'/i.test(
      readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8'),
    ),
  );
  expect(backfillIdx, 'push-branch backfill migration missing from journal').toBeGreaterThan(0);
  const dir = temp('cairn-migrations-pre-backfill-');
  mkdirSync(join(dir, 'meta'));
  for (const entry of journal.entries.slice(0, backfillIdx)) {
    cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
    const snapshot = join(MIGRATIONS_FOLDER, 'meta', `${entry.tag}_snapshot.json`);
    try {
      cpSync(snapshot, join(dir, 'meta', `${entry.tag}_snapshot.json`));
    } catch {}
  }
  const full = readJournal(MIGRATIONS_FOLDER);
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...full, entries: full.entries.slice(0, backfillIdx) }, null, 2),
  );
  return dir;
}

interface LegacyAgent {
  id: string;
  tools: string;
}

function buildPreBackfillDb(rows: LegacyAgent[]): { dbPath: string } {
  const dir = temp('cairn-backfill-db-');
  const dbPath = join(dir, 'server.db');
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: preBackfillMigrations() });
  const { team } = seed(db);
  const insert = sqlite.prepare(
    'INSERT INTO agent (id, teamId, displayName, tools, secrets, skills, mcpServers) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const row of rows) {
    insert.run(row.id, team.id, `存量-${row.id}`, row.tools, '[]', '[]', '[]');
  }
  sqlite.close();
  return { dbPath };
}

function readTools(dbPath: string, id: string): string[] {
  const sqlite = new Database(dbPath, { readonly: true });
  const row = sqlite.prepare('SELECT tools FROM agent WHERE id = ?').get(id) as {
    tools: string;
  };
  sqlite.close();
  return JSON.parse(row.tools);
}

describe('0018 push-branch backfill (XMON-84 B4 legacy rows preserved on delivery)', () => {
  test('pre-upgrade legacy db -> full backfill migration rerun: rows missing the push branch are all backfilled, existing ones not duplicated', () => {
    const { dbPath } = buildPreBackfillDb([
      { id: 'bf-empty', tools: '[]' },
      { id: 'bf-merge-only', tools: '["合并分支"]' },
      { id: 'bf-has-push', tools: '["推送分支"]' },
      { id: 'bf-junk', tools: '["远程 shell","自造档"]' },
    ]);
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.close();

    expect(readTools(dbPath, 'bf-empty')).toEqual(['推送分支']);
    expect(readTools(dbPath, 'bf-merge-only')).toEqual(['合并分支', '推送分支']);
    expect(readTools(dbPath, 'bf-has-push')).toEqual(['推送分支']);
    expect(readTools(dbPath, 'bf-junk')).toEqual(['自造档', '推送分支']);
  });

  test('backfill SQL itself is idempotent (defensive replay produces no duplicates)', () => {
    const { dbPath } = buildPreBackfillDb([{ id: 'bf-replay', tools: '[]' }]);
    const entry = readJournal(MIGRATIONS_FOLDER).entries.find((e) =>
      /json_insert\(`?tools`?.*'推送分支'/i.test(
        readFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), 'utf8'),
      ),
    )!;
    const backfillSql = readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8');
    const sqlite = new Database(dbPath);
    sqlite.exec(backfillSql);
    sqlite.exec(backfillSql);
    sqlite.close();
    expect(readTools(dbPath, 'bf-replay')).toEqual(['推送分支']);
  });
});
