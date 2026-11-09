import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { is } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { migrateUpTo } from './migrate-helpers.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string }[];
};

test('current schema snapshot and journal retire the binding without rewriting history', () => {
  expect(new Set(journal.entries.map((entry) => entry.idx)).size).toBe(journal.entries.length);
  expect(new Set(journal.entries.map((entry) => entry.tag)).size).toBe(journal.entries.length);
  expect(journal.entries.some((entry) => entry.tag === '0062_feishu_binding')).toBe(true);
  const latest = journal.entries.at(-1);
  const snapshot = JSON.parse(
    readFileSync(
      join(MIGRATIONS_FOLDER, 'meta', `${String(latest?.idx).padStart(4, '0')}_snapshot.json`),
      'utf8',
    ),
  ) as { tables: Record<string, { columns: Record<string, unknown> }> };
  const tables = Object.values(schema)
    .filter((value) => is(value, SQLiteTable))
    .map((table) => getTableConfig(table as SQLiteTable));
  expect(Object.keys(snapshot.tables).sort()).toEqual(tables.map((table) => table.name).sort());
  for (const table of tables)
    expect(Object.keys(snapshot.tables[table.name]?.columns ?? {}).sort()).toEqual(
      table.columns.map((column) => column.name).sort(),
    );
  expect(snapshot.tables).not.toHaveProperty('feishu_binding');
  expect(schema).not.toHaveProperty('feishuBinding');
});

test.each(['fresh', 'empty upgrade', 'configured upgrade'])(
  '%s removes only Feishu configuration',
  (mode) => {
    const directory = makeTestTempDir('cairn-retirement-');
    const sqlite = new Database(join(directory, 'test.sqlite'));
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    try {
      if (mode !== 'fresh') {
        migrateUpTo(sqlite, directory, '0131_project_group');
        sqlite.exec(`
        INSERT INTO user (id, displayName) VALUES ('owner', 'Test owner');
        INSERT INTO team (id, name, createdAt) VALUES ('retained', 'Retained team', 1);
        INSERT INTO secret (id, teamId, name, valueCipher) VALUES ('personal', 'retained', 'feishu.bot.app-secret', 'user-owned-cipher');
        INSERT INTO project (id, name, teamId) VALUES ('project', 'Retained project', 'retained');
        INSERT INTO todo (id, teamId, projectId, title, phase, phaseAt, seqNum) VALUES ('task', 'retained', 'project', 'Plan approval', 'confirm', 1, 1);
        INSERT INTO build (id, todoId, withPlan, triggerSource, createdAt) VALUES ('build', 'task', 1, 'manual', 1);
        INSERT INTO plan (id, buildId, content, createdAt) VALUES ('plan', 'build', 'Retained plan', 1);
        INSERT INTO notification (id, teamId, userId, type, entityId, entityRef, agentName, createdAt) VALUES ('notice', 'retained', 'owner', 'plan', 'task', '{}', 'Test agent', 1);
        INSERT INTO push_subscription (id, teamId, userId, endpoint, p256dh, auth, createdAt) VALUES ('push', 'retained', 'owner', 'https://push.example/test', 'test-key', 'test-auth', 1);
      `);
        if (mode === 'configured upgrade') {
          sqlite.exec(`
          INSERT INTO feishu_binding (teamId, userId, openId, cairnOrigin, appIdCipher, appSecretCipher, createdAt, updatedAt)
          VALUES ('retained', 'owner', 'ou_test', 'https://cairn.example', 'unreadable-old-cipher', 'unreadable-old-cipher', 1, 1);
        `);
        }
      }
      const retainedTables = [
        'user',
        'team',
        'secret',
        'todo',
        'build',
        'plan',
        'notification',
        'push_subscription',
      ];
      const before =
        mode === 'fresh'
          ? []
          : retainedTables.map((table) => sqlite.prepare(`SELECT * FROM ${table}`).all());
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(
        sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'feishu_binding%'").all(),
      ).toEqual([]);
      if (mode !== 'fresh')
        expect(
          retainedTables.map((table) => sqlite.prepare(`SELECT * FROM ${table}`).all()),
        ).toEqual(before);
      const migrations = sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get();
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual(
        migrations,
      );
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
