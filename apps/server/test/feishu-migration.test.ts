import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { is } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { expect, test } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string }[];
};

test('Feishu migration follows all main migrations with unique indexes and a complete current-schema snapshot', () => {
  expect(journal.entries.map((entry) => entry.tag)).toContain('0059_retire_zero_use');
  expect(journal.entries.map((entry) => entry.tag)).toContain('0060_chief_message_project');
  expect(journal.entries.map((entry) => entry.tag)).toContain('0061_first_pr_report');
  expect(new Set(journal.entries.map((entry) => entry.idx)).size).toBe(journal.entries.length);
  expect(new Set(journal.entries.map((entry) => entry.tag)).size).toBe(journal.entries.length);
  const latest = journal.entries.at(-1);
  expect(journal.entries.some((entry) => entry.tag.endsWith('_feishu_binding'))).toBe(true);
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
  expect(snapshot.tables.github_connection?.columns).toHaveProperty('refreshTokenCipher');
  expect(snapshot.tables).not.toHaveProperty('shell_command');
});

test.each(['fresh', 'upgrade'])(
  '%s database applies Feishu migration and preserves main data',
  (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'cairn-1974-migration-'));
    const sqlite = new Database(join(directory, 'test.sqlite'));
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    try {
      if (mode === 'upgrade') {
        const main = join(directory, 'main');
        mkdirSync(join(main, 'meta'), { recursive: true });
        const cut = journal.entries.findIndex((entry) => entry.tag.endsWith('_feishu_binding'));
        expect(cut).toBeGreaterThan(0);
        const entries = journal.entries.slice(0, cut);
        writeFileSync(join(main, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
        for (const entry of entries)
          copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(main, `${entry.tag}.sql`));
        migrate(db, { migrationsFolder: main });
        sqlite.exec(
          "INSERT INTO team (id, name, createdAt) VALUES ('retained', 'Retained team', 1)",
        );
        sqlite.exec(
          "INSERT INTO github_connection (teamId, login, accessTokenCipher, refreshTokenCipher, accessTokenExpiresAt, scope, createdAt) VALUES ('retained', 'owner', 'encrypted-access', 'encrypted-refresh', 1234, 'repo', 1)",
        );
      }
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(
        sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'feishu_binding'").get(),
      ).toEqual({ name: 'feishu_binding' });
      const bindingColumns = (
        sqlite.prepare("PRAGMA table_info('feishu_binding')").all() as { name: string }[]
      ).map((column) => column.name);
      expect(bindingColumns).toEqual(
        expect.arrayContaining([
          'teamId',
          'userId',
          'openId',
          'cairnOrigin',
          'appIdCipher',
          'appSecretCipher',
          'createdAt',
          'updatedAt',
        ]),
      );
      expect(
        sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'shell_command'").get(),
      ).toBeUndefined();
      if (mode === 'upgrade') {
        expect(sqlite.prepare("SELECT name FROM team WHERE id = 'retained'").get()).toEqual({
          name: 'Retained team',
        });
        expect(
          sqlite
            .prepare(
              "SELECT refreshTokenCipher, accessTokenExpiresAt FROM github_connection WHERE teamId = 'retained'",
            )
            .get(),
        ).toEqual({ refreshTokenCipher: 'encrypted-refresh', accessTokenExpiresAt: 1234 });
      }
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
