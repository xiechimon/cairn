import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, expect, test } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';

const REFRESH_TAG = '0057_github_connection_refresh';
const REFRESH_COLUMNS = [
  'refreshTokenCipher',
  'accessTokenExpiresAt',
  'disconnectedReason',
] as const;
const ATTACHMENT_COLUMNS = ['userSpecAttachmentIds', 'userMessageAttachmentIds'] as const;

type Journal = {
  entries: { idx: number; when: number; tag: string }[];
};

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function readJournal(): Journal {
  return JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'));
}

function columnNames(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (column) => column.name,
  );
}

test('a database that already has the user-attachment migration gains the GitHub refresh columns', () => {
  const journal = readJournal();
  const entry = journal.entries.find((item) => item.tag === REFRESH_TAG);
  if (entry === undefined) throw new Error(`${REFRESH_TAG} missing from journal`);
  const earlier = journal.entries.filter((item) => item.idx < entry.idx);
  expect(entry.when).toBeGreaterThan(Math.max(...earlier.map((item) => item.when)));

  const cut = journal.entries.findIndex((item) => item.tag === REFRESH_TAG);
  const prior = mkdtempSync(join(tmpdir(), 'cairn-migrations-pre-github-refresh-'));
  temps.push(prior);
  mkdirSync(join(prior, 'meta'));
  for (const item of journal.entries.slice(0, cut)) {
    cpSync(join(MIGRATIONS_FOLDER, `${item.tag}.sql`), join(prior, `${item.tag}.sql`));
  }
  writeFileSync(
    join(prior, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
  );

  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: prior });
  const before = columnNames(sqlite, 'github_connection');
  for (const name of REFRESH_COLUMNS) expect(before).not.toContain(name);
  for (const name of ATTACHMENT_COLUMNS) expect(columnNames(sqlite, 'todo')).toContain(name);

  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  const after = columnNames(sqlite, 'github_connection');
  for (const name of REFRESH_COLUMNS) expect(after).toContain(name);
  for (const name of ATTACHMENT_COLUMNS) expect(columnNames(sqlite, 'todo')).toContain(name);
  sqlite.close();
});

test('the GitHub refresh snapshot keeps the todo attachment columns from the previous migration', () => {
  const journal = readJournal();
  const entry = journal.entries.find((item) => item.tag === REFRESH_TAG);
  if (entry === undefined) throw new Error(`${REFRESH_TAG} missing from journal`);
  const snapshot = JSON.parse(
    readFileSync(
      join(MIGRATIONS_FOLDER, 'meta', `${String(entry.idx).padStart(4, '0')}_snapshot.json`),
      'utf8',
    ),
  ) as { tables: { todo: { columns: Record<string, unknown> } } };
  for (const name of ATTACHMENT_COLUMNS) {
    expect(snapshot.tables.todo.columns).toHaveProperty(name);
  }
});
