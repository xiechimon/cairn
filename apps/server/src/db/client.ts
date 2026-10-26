import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { exportLegacyTables } from './legacy-export.js';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

function resolveMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcForm = resolve(here, '../../drizzle');
  const bundleForm = resolve(here, '../drizzle');
  return existsSync(join(srcForm, 'meta', '_journal.json')) ? srcForm : bundleForm;
}

export const MIGRATIONS_FOLDER = resolveMigrationsFolder();

export interface OpenedDb {
  db: Db;
  close(): void;
}

export function openDbWithHandle(
  dbPath: string,
  opts: { legacyExportDir?: string } = {},
): OpenedDb {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma('busy_timeout = 10000');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  exportLegacyTables(sqlite, opts.legacyExportDir);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => sqlite.close() };
}

export function openDb(dbPath: string): Db {
  return openDbWithHandle(dbPath).db;
}

export function openMemoryDb(): Db {
  return openDb(':memory:');
}
