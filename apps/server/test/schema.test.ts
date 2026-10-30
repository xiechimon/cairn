import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DB_TABLES } from '@cairn/shared';
import Database from 'better-sqlite3';
import { is } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, test } from 'vitest';
import { MIGRATIONS_FOLDER, openMemoryDb } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';

describe('the schema and migration journal (the 01 §6 list)', () => {
  test('the drizzle schema table-name set = DB_TABLES', () => {
    const tables = Object.values(schema).filter((v) => is(v, SQLiteTable));
    const names = tables.map((t) => getTableConfig(t as SQLiteTable).name).sort();
    expect(names).toEqual([...DB_TABLES].sort());
    expect(names).toHaveLength(DB_TABLES.length);
    expect(names).toContain('chief');
    expect(names).toContain('attachment');
    expect(names).toContain('branch_sync');
    expect(names).toContain('github_connection');
    expect(names).toContain('schedule');
    expect(names).toContain('schedule_report');
    expect(names).not.toContain('shell_command');
    expect(names).toContain('gate_verdict');
  });

  test('the migration SQL is committed and covers every table (accumulated across migrations)', () => {
    const journal = JSON.parse(
      readFileSync(resolve(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] };
    expect(journal.entries.length).toBeGreaterThanOrEqual(1);
    const allSql = journal.entries
      .map((entry) => readFileSync(resolve(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8'))
      .join('\n');
    for (const table of DB_TABLES) {
      expect(allSql, `missing CREATE TABLE \`${table}\``).toContain(`CREATE TABLE \`${table}\``);
    }
  });

  test('upgrades a database already migrated through the previous main migration', () => {
    const journal = JSON.parse(
      readFileSync(resolve(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { tag: string; when: number }[] };
    const previous = journal.entries.slice(0, -1);
    const directory = mkdtempSync(resolve(tmpdir(), 'cairn-migration-prefix-'));
    const sqlite = new Database(':memory:');
    try {
      mkdirSync(resolve(directory, 'meta'));
      writeFileSync(
        resolve(directory, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: previous }),
      );
      for (const entry of previous)
        copyFileSync(
          resolve(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
          resolve(directory, `${entry.tag}.sql`),
        );
      const db = drizzle(sqlite, { schema });
      migrate(db, { migrationsFolder: directory });
      const before = seed(db);
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(seed(db).user.id).toBe(before.user.id);
      expect(db.select().from(schema.pushDelivery).all()).toEqual([]);
      expect(db.select().from(schema.harnessEvalAttempt).all()).toEqual([]);
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('the migrations apply cleanly to an in-memory db', () => {
    expect(() => openMemoryDb()).not.toThrow();
  });
});

describe('seed (02 §2 single user + team shape-kept at one row)', () => {
  test('idempotent: a second seed returns the same user/team', () => {
    const db = openMemoryDb();
    const first = seed(db);
    const second = seed(db);
    expect(second.user.id).toBe(first.user.id);
    expect(second.team.id).toBe(first.team.id);
    expect(first.team.plan).toBe('free');
  });
});
