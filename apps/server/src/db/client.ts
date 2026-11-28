import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { foldMemoryIndexes } from '../services/memory.js';
import { agentLayerUpgradePending, runAgentLayerUpgrade } from './agent-layer-upgrade.js';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

function resolveMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcForm = resolve(here, '../../drizzle');
  const bundleForm = resolve(here, '../drizzle');
  return existsSync(join(srcForm, 'meta', '_journal.json')) ? srcForm : bundleForm;
}

export const MIGRATIONS_FOLDER = resolveMigrationsFolder();

const AGENT_LAYER_BACKUP_TAG = '0119_agent_layer_backup';

function migrateThrough(db: Db, lastTag: string): void {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const cut = journal.entries.findIndex((entry) => entry.tag === lastTag);
  const folder = mkdtempSync(join(tmpdir(), 'cairn-migrate-'));
  try {
    mkdirSync(join(folder, 'meta'));
    const entries = journal.entries.slice(0, cut + 1);
    writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) {
      copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    }
    migrate(db, { migrationsFolder: folder });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

interface FkViolation {
  table: string;
  rowid: number | bigint | null;
  parent: string;
}

function foreignKeyViolations(sqlite: Database.Database): Set<string> {
  const rows = sqlite.prepare('SELECT * FROM pragma_foreign_key_check').all() as FkViolation[];
  return new Set(rows.map((row) => `${row.table}|${row.rowid}|${row.parent}`));
}

export function migrateDatabase(
  db: Db,
  sqlite: Database.Database,
  migrationsFolder = MIGRATIONS_FOLDER,
): void {
  registerStepWriterGeneration(sqlite);
  const foreignKeysOn = sqlite.pragma('foreign_keys', { simple: true }) === 1;
  if (foreignKeysOn) sqlite.pragma('foreign_keys = OFF');
  const before = foreignKeyViolations(sqlite);
  try {
    if (migrationsFolder === MIGRATIONS_FOLDER && agentLayerUpgradePending(sqlite)) {
      migrateThrough(db, AGENT_LAYER_BACKUP_TAG);
      runAgentLayerUpgrade(sqlite);
    }
    migrate(db, { migrationsFolder });
  } finally {
    if (foreignKeysOn) sqlite.pragma('foreign_keys = ON');
  }
  const added = [...foreignKeyViolations(sqlite)].filter((key) => !before.has(key));
  if (added.length > 0) {
    const names = [...new Set(added.map((key) => key.split('|')[0]))];
    throw new Error(
      `foreign key violations introduced by migrations (${added.length} rows in ${names.join(', ')})`,
    );
  }
  if (migrationsFolder === MIGRATIONS_FOLDER) foldMemoryIndexes(db);
}

export interface OpenedDb {
  db: Db;
  sqlite: Database.Database;
  close(): void;
}

export function openDbWithHandle(dbPath: string): OpenedDb {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = openConnection(dbPath);
  const db = drizzle(sqlite, { schema });
  migrateDatabase(db, sqlite);
  return { db, sqlite, close: () => sqlite.close() };
}

export function registerStepWriterGeneration(sqlite: Database.Database): void {
  sqlite.function('cairn_step_write_generation', { deterministic: true }, () => 1);
}

function openConnection(source: string | Buffer): Database.Database {
  const sqlite = new Database(source);
  registerStepWriterGeneration(sqlite);
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
    migrateDatabase(drizzle(sqlite, { schema }), sqlite);
    migratedMemoryImage = sqlite.serialize();
    sqlite.close();
  }
  return migratedMemoryImage;
}

export function openMemoryDb(): Db {
  return drizzle(openConnection(migratedImage()), { schema });
}
