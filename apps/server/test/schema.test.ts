import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DB_TABLES } from '@cairn/shared';
import Database from 'better-sqlite3';
import { is, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, test } from 'vitest';
import { MIGRATIONS_FOLDER, openMemoryDb } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';

describe('the 37-table migration (the 01 §6 list)', () => {
  test('the drizzle schema table-name set = DB_TABLES', () => {
    const tables = Object.values(schema).filter((v) => is(v, SQLiteTable));
    const names = tables.map((t) => getTableConfig(t as SQLiteTable).name).sort();
    expect(names).toEqual([...DB_TABLES].sort());
    expect(names).toHaveLength(44);
    expect(names).toContain('autonomous_merge_admission');
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

  test.each(['0067_schedule_report', '0068_odd_cloak'])(
    'upgrades a database migrated through %s without rewriting its migration history',
    (previousTag) => {
      const previous = mkdtempSync(join(tmpdir(), 'cairn-1405-migrations-'));
      const sqlite = new Database(':memory:');
      const db = drizzle(sqlite, { schema });
      try {
        const journal = JSON.parse(
          readFileSync(resolve(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
        ) as { entries: { tag: string; when: number }[] };
        const tip = journal.entries.findIndex((entry) => entry.tag === previousTag);
        if (tip < 0) throw new Error('previous migration missing');
        const entries = journal.entries.slice(0, tip + 1);
        mkdirSync(join(previous, 'meta'));
        writeFileSync(
          join(previous, 'meta/_journal.json'),
          JSON.stringify({ ...journal, entries }),
        );
        for (const entry of entries)
          copyFileSync(
            resolve(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
            join(previous, `${entry.tag}.sql`),
          );
        migrate(db, { migrationsFolder: previous });
        db.run(sql`INSERT INTO team (id, name, createdAt) VALUES ('legacy', 'Legacy', 0)`);
        migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
        const columns = db.all(sql`PRAGMA table_info(api_key)`) as { name: string }[];
        expect(columns.some((column) => column.name === 'machineAccess')).toBe(true);
        expect(db.select().from(schema.team).get()?.maxAutonomousMergesPerDay).toBe(10);
        expect(db.select().from(schema.autonomousMergeAdmission).all()).toEqual([]);
        expect(db.select().from(schema.harnessEvalAttempt).all()).toEqual([]);
      } finally {
        sqlite.close();
        rmSync(previous, { recursive: true, force: true });
      }
    },
  );

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
