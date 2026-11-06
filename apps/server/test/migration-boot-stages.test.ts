import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER, openDbWithHandle } from '../src/db/client.js';
import {
  AgentLayerMigrationError,
  runAgentLayerDataMigration,
} from '../src/legacy/agent-layer/data-migration.js';
import { migrateUpTo, migrationsThrough } from './migrate-helpers.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

function legacyInstall(withAgent: boolean): string {
  const dir = makeTestTempDir('migration-boot-');
  dirs.push(dir);
  const dbPath = join(dir, 'server.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  migrateUpTo(sqlite, dir, '0109_overconfident_omega_red');
  sqlite.exec("INSERT INTO user (id, displayName) VALUES ('u1', 'Owner')");
  sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('t1', 'Team', 1)");
  if (withAgent) {
    sqlite.exec(
      `INSERT INTO agent (id, teamId, displayName, provider, modelId, persona, tools, secrets, mcpServers)
       VALUES ('agent-impl', 't1', 'Impl', 'claude-code', 'claude-sonnet-5-5', 'implementer', '[]', '[]', '[]')`,
    );
  }
  sqlite.close();
  return dbPath;
}

function tables(dbPath: string): string[] {
  const sqlite = new Database(dbPath, { readonly: true });
  const names = (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
  sqlite.close();
  return names;
}

describe('staged boot migration', () => {
  test('an install with agents is migrated on the first start and the agent table is dropped on the second', () => {
    const dbPath = legacyInstall(true);
    const logged: string[] = [];
    const first = openDbWithHandle(dbPath, {
      migrationLogger: { info: (_fields, message) => logged.push(message) },
    });
    first.close();
    expect(tables(dbPath)).toContain('agent');
    expect(tables(dbPath)).toContain('legacy_agent_backup');
    expect(logged.filter((line) => line.includes('team migrated'))).toHaveLength(1);
    expect(logged.at(-1)).toContain('dropped on the next start');
    const second = openDbWithHandle(dbPath);
    second.close();
    expect(tables(dbPath)).not.toContain('agent');
    expect(tables(dbPath)).toContain('legacy_agent_backup');
    const third = openDbWithHandle(dbPath);
    third.close();
    const sqlite = new Database(dbPath, { readonly: true });
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM routing_rule WHERE use = 'session'").get(),
    ).toEqual({
      n: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS n FROM data_migration').get()).toEqual({ n: 1 });
    sqlite.close();
  });

  test('a fresh install has nothing to migrate and drops the agent table on the first start', () => {
    const dbPath = legacyInstall(false);
    const opened = openDbWithHandle(dbPath);
    opened.close();
    expect(tables(dbPath)).not.toContain('agent');
    expect(tables(dbPath)).toContain('data_migration');
  });

  test('a failing data step aborts with an actionable error and leaves nothing partial', () => {
    const dbPath = legacyInstall(true);
    const sqlite = new Database(dbPath);
    migrate(drizzle(sqlite), { migrationsFolder: stageFolder() });
    sqlite.exec(
      "CREATE TRIGGER block_rules BEFORE INSERT ON routing_rule BEGIN SELECT RAISE(ABORT, 'blocked by test'); END",
    );
    sqlite.close();
    expect(() => openDbWithHandle(dbPath)).toThrow(AgentLayerMigrationError);
    expect(() => openDbWithHandle(dbPath)).toThrow(/Nothing was written and no table was dropped/);
    const after = new Database(dbPath, { readonly: true });
    expect(after.prepare('SELECT count(*) AS n FROM routing_rule').get()).toEqual({ n: 0 });
    expect(after.prepare('SELECT count(*) AS n FROM data_migration').get()).toEqual({ n: 0 });
    expect(tables(dbPath)).toContain('agent');
    after.close();
  });

  test('the data step is idempotent through its marker', () => {
    const dbPath = legacyInstall(true);
    const opened = openDbWithHandle(dbPath);
    opened.close();
    const sqlite = new Database(dbPath);
    expect(runAgentLayerDataMigration(sqlite).alreadyDone).toBe(true);
    sqlite.close();
  });

  test('0116 refuses to run before the marker exists', () => {
    const dbPath = legacyInstall(true);
    const sqlite = new Database(dbPath);
    migrate(drizzle(sqlite), { migrationsFolder: stageFolder() });
    expect(() => migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER })).toThrow();
    expect(tables(dbPath)).toContain('agent');
    sqlite.close();
  });
});

function stageFolder(): string {
  const dir = makeTestTempDir('migration-boot-stage-');
  dirs.push(dir);
  return migrationsThrough(dir, '0115_agent_layer_backup');
}
