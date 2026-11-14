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
import { runAgentLayerDataMigration } from '../legacy/agent-layer/data-migration.js';
import { foldMemoryIndexes } from '../services/memory.js';
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

export interface MigrationLogger {
  info(fields: Record<string, unknown>, message: string): void;
}

const AGENT_LAYER_BACKUP_TAG = '0119_agent_layer_backup';

function agentLayerMarkerExists(sqlite: Database.Database): boolean {
  return (
    sqlite.prepare("SELECT 1 FROM data_migration WHERE id = 'drop-agents'").get() !== undefined
  );
}

function migrateThrough(db: Db, lastTag: string): void {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const cut = journal.entries.findIndex((entry) => entry.tag === lastTag);
  const folder = mkdtempSync(join(tmpdir(), 'cairn-migrate-'));
  try {
    mkdirSync(join(folder, 'meta'));
    const entries = journal.entries.slice(0, cut + 1);
    writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) {
      copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    }
    migrate(db, { migrationsFolder: folder });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export function migrateDatabase(sqlite: Database.Database, db: Db, logger?: MigrationLogger): void {
  migrateThrough(db, AGENT_LAYER_BACKUP_TAG);
  const markerAtStart = agentLayerMarkerExists(sqlite);
  let dropAgents = markerAtStart;
  if (!markerAtStart) {
    const outcome = runAgentLayerDataMigration(sqlite);
    for (const team of outcome.teams) {
      logger?.info({ ...team }, 'agent-layer data migration: team migrated');
    }
    logger?.info(
      { teams: outcome.teams.length, hadAgents: outcome.hadAgents },
      outcome.hadAgents
        ? 'agent-layer data migration done; the agent table is dropped on the next start'
        : 'agent-layer data migration done; no agents to migrate',
    );
    dropAgents = !outcome.hadAgents;
  }
  if (!dropAgents) return;
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  foldMemoryIndexes(db);
}

export interface OpenedDb {
  db: Db;
  close(): void;
}

export function openDbWithHandle(
  dbPath: string,
  opts: { legacyExportDir?: string; migrationLogger?: MigrationLogger } = {},
): OpenedDb {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma('busy_timeout = 10000');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('cache_size = -131072');
  sqlite.pragma('foreign_keys = ON');
  exportLegacyTables(sqlite, opts.legacyExportDir);
  const db = drizzle(sqlite, { schema });
  migrateDatabase(sqlite, db, opts.migrationLogger);
  return { db, close: () => sqlite.close() };
}

export function openDb(dbPath: string): Db {
  return openDbWithHandle(dbPath).db;
}

export function openMemoryDb(): Db {
  return openDb(':memory:');
}
