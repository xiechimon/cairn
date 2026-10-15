// #1241 机器并发覆盖位回填 migration：存量 maxConcurrent 非默认值 = 用户经 PATCH
// 写过，回填为覆盖（心跳不再用推荐值改它）；恰为默认 3 的存量行与默认无从区分，
// 按未覆盖处理（吃推荐值）。
//
// 失败方式（先于实现固化，仓测试纪律）：
// B1 非默认存量值没转成覆盖 → 升级后首拍心跳把用户的数改成推荐值（用户值不持久）。
// B2 默认 3 的存量行被标成覆盖 → 存量机器永远吃不到推荐值（功能对存量失效）。
//
// 定位律承 agent-skills-split-backfill（#1169）：按内容找含 maxConcurrentOverridden
// 回填 UPDATE 的那条，迁移序号不写死（撞号纪律：合并期重编号后零改动）。

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, describe, expect, test } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';

const temps: string[] = [];
function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function readJournal(folder: string): { entries: { idx: number; tag: string }[] } {
  return JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'));
}

const OVERRIDE_MARKER = /UPDATE `machine` SET `maxConcurrentOverridden`/;

function findBackfillEntry(): { idx: number; tag: string } {
  const entry = readJournal(MIGRATIONS_FOLDER).entries.find((e) =>
    OVERRIDE_MARKER.test(readFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), 'utf8')),
  );
  expect(entry, 'journal 里找不到 maxConcurrentOverridden 回填 migration').toBeTruthy();
  return entry!;
}

/** 复制 migrations 目录并截到回填那条之前 = 升级前旧库形态。 */
function preBackfillMigrations(): string {
  const journal = readJournal(MIGRATIONS_FOLDER);
  const backfillIdx = journal.entries.findIndex((e) => e.tag === findBackfillEntry().tag);
  expect(backfillIdx, '回填 migration 应在 journal 内').toBeGreaterThan(0);
  const dir = temp('pacman-migrations-pre-concurrency-');
  mkdirSync(join(dir, 'meta'));
  for (const entry of journal.entries.slice(0, backfillIdx)) {
    cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
  }
  const full = readJournal(MIGRATIONS_FOLDER);
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...full, entries: full.entries.slice(0, backfillIdx) }, null, 2),
  );
  return dir;
}

function buildPreBackfillDb(rows: { id: string; maxConcurrent: number }[]): string {
  const dir = temp('pacman-concurrency-db-');
  const dbPath = join(dir, 'server.db');
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: preBackfillMigrations() });
  const { team } = seed(db);
  const insert = sqlite.prepare(
    'INSERT INTO machine (id, teamId, name, maxConcurrent) VALUES (?, ?, ?, ?)',
  );
  for (const row of rows) {
    insert.run(row.id, team.id, `存量-${row.id}`, row.maxConcurrent);
  }
  sqlite.close();
  return dbPath;
}

function readFlags(dbPath: string, id: string): { maxConcurrentOverridden: number } {
  const sqlite = new Database(dbPath, { readonly: true });
  const row = sqlite
    .prepare('SELECT maxConcurrentOverridden FROM machine WHERE id = ?')
    .get(id) as { maxConcurrentOverridden: number };
  sqlite.close();
  return row;
}

describe('#1241 机器并发覆盖位回填（存量用户值持久 + 默认行吃推荐值）', () => {
  test('升级前旧库 → 补跑回填：B1 非默认值转覆盖，B2 默认 3 不覆盖', () => {
    const dbPath = buildPreBackfillDb([
      { id: 'cc-user-5', maxConcurrent: 5 },
      { id: 'cc-user-16', maxConcurrent: 16 },
      { id: 'cc-default-3', maxConcurrent: 3 },
    ]);
    const sqlite = new Database(dbPath);
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.close();

    expect(readFlags(dbPath, 'cc-user-5')).toEqual({ maxConcurrentOverridden: 1 });
    expect(readFlags(dbPath, 'cc-user-16')).toEqual({ maxConcurrentOverridden: 1 });
    expect(readFlags(dbPath, 'cc-default-3')).toEqual({ maxConcurrentOverridden: 0 });
  });
});
