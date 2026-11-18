import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { foldMemoryIndexes } from '../services/memory.js';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

function resolveMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcForm = resolve(here, '../../drizzle');
  const bundleForm = resolve(here, '../drizzle');
  return existsSync(join(srcForm, 'meta', '_journal.json')) ? srcForm : bundleForm;
}

export const MIGRATIONS_FOLDER = resolveMigrationsFolder();

export function migrateDatabase(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  foldMemoryIndexes(db);
}

export interface OpenedDb {
  db: Db;
  close(): void;
}

export function openDbWithHandle(dbPath: string): OpenedDb {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = openConnection(dbPath);
  const db = drizzle(sqlite, { schema });
  migrateDatabase(db);
  return { db, close: () => sqlite.close() };
}

function openConnection(source: string | Buffer): Database.Database {
  const sqlite = new Database(source);
  sqlite.pragma('busy_timeout = 10000');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('cache_size = -131072');
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

export function openDb(dbPath: string): Db {
  return openDbWithHandle(dbPath).db;
}

let migratedMemoryImage: Buffer | null = null;

function migratedImage(): Buffer {
  if (migratedMemoryImage === null) {
    const sqlite = openConnection(':memory:');
    migrateDatabase(drizzle(sqlite, { schema }));
    migratedMemoryImage = sqlite.serialize();
    sqlite.close();
  }
  return migratedMemoryImage;
}

export function openMemoryDb(): Db {
  return drizzle(openConnection(migratedImage()), { schema });
}
