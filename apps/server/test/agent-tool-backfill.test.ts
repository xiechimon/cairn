// 0018 agent 推送分支回填 migration（XMON-84 B4）：XMON-77 落地 daemon/server
// 收尾闸后，存量行（tools 缺「推送分支」）收尾自动 push 会被软拒、合并请求会
// 被 fail-fast/403——「不破坏交付」判据要求存量行回填「推送分支」。回填随
// migration 进 PR 交用户审，不绕开 PR 动生产数据。
//
// 失败方式（先于实现固化）：
// B1 空集/仅他档/带词表外残值的行没回填 → 升级后该 Agent 照样推不了工作分支。
// B2 已含「推送分支」的行被重复追加 → ['推送分支','推送分支'] 死存储。
// B3 SQL 本体不幂等 → 双跑（防御性重放）后出现 B2 的重复形态。
// B4 全新库（0 agent 行）→ 回填 UPDATE 应为无炸 no-op（openMemoryDb 每次测试
//    都在隐式覆盖：迁移可干净应用）。
//
// 旧库构造复用 legacy-export.test.ts 的截尾手法（migration 序号不写死——
// 撞号纪律：按「含本回填 UPDATE 的那条」定位，合并期重编号后零改动）。

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

/** 复制 migrations 目录并截掉「回填那条」起 = 升级前旧库形态。 */
function preBackfillMigrations(): string {
  const journal = readJournal(MIGRATIONS_FOLDER);
  const backfillIdx = journal.entries.findIndex((entry) =>
    /json_insert\(`?tools`?.*'推送分支'/i.test(
      readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8'),
    ),
  );
  expect(backfillIdx, 'journal 里找不到推送分支回填 migration').toBeGreaterThan(0);
  const dir = temp('cairn-migrations-pre-backfill-');
  mkdirSync(join(dir, 'meta'));
  for (const entry of journal.entries.slice(0, backfillIdx)) {
    cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
    const snapshot = join(MIGRATIONS_FOLDER, 'meta', `${entry.tag}_snapshot.json`);
    try {
      cpSync(snapshot, join(dir, 'meta', `${entry.tag}_snapshot.json`));
    } catch {
      /* 0008 型 snapshot 缺位先例（db-check.mjs 注）：跳过可接受 */
    }
  }
  const full = readJournal(MIGRATIONS_FOLDER);
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...full, entries: full.entries.slice(0, backfillIdx) }, null, 2),
  );
  return dir;
}

interface LegacyAgent {
  id: string;
  tools: string;
}

/** 建回填前旧库 + seed team + 插四种形态的 agent 行。 */
function buildPreBackfillDb(rows: LegacyAgent[]): { dbPath: string } {
  const dir = temp('cairn-backfill-db-');
  const dbPath = join(dir, 'server.db');
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: preBackfillMigrations() });
  const { team } = seed(db);
  const insert = sqlite.prepare(
    'INSERT INTO agent (id, teamId, displayName, tools, secrets, skills, mcpServers) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const row of rows) {
    insert.run(row.id, team.id, `存量-${row.id}`, row.tools, '[]', '[]', '[]');
  }
  sqlite.close();
  return { dbPath };
}

function readTools(dbPath: string, id: string): string[] {
  const sqlite = new Database(dbPath, { readonly: true });
  const row = sqlite.prepare('SELECT tools FROM agent WHERE id = ?').get(id) as {
    tools: string;
  };
  sqlite.close();
  return JSON.parse(row.tools);
}

describe('0018 推送分支回填（XMON-84 B4 存量不破坏交付）', () => {
  test('升级前旧库 → 补跑全量 migration：缺推送分支的行全回填，已有的不重复', () => {
    const { dbPath } = buildPreBackfillDb([
      { id: 'bf-empty', tools: '[]' }, // 空集（schema 缺省形态，多数存量行）
      { id: 'bf-merge-only', tools: '["合并分支"]' }, // 有合并无推送
      { id: 'bf-has-push', tools: '["推送分支"]' }, // 已有推送
      { id: 'bf-junk', tools: '["远程 shell","自造档"]' }, // 词表外残值 + 无推送
    ]);
    // 升级动作 = 老 server 进程带着新 migration 目录启动（openDbWithHandle
    // 同路径；这里直接对旧库跑全量 migrate，效果等价、可断言）。
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.close();

    expect(readTools(dbPath, 'bf-empty')).toEqual(['推送分支']);
    expect(readTools(dbPath, 'bf-merge-only')).toEqual(['合并分支', '推送分支']);
    expect(readTools(dbPath, 'bf-has-push')).toEqual(['推送分支']);
    // 词表外残值读侧照旧宽（清退走写侧 filterAgentTools），推送分支追加在尾。
    expect(readTools(dbPath, 'bf-junk')).toEqual(['远程 shell', '自造档', '推送分支']);
  });

  test('回填 SQL 本体幂等（防御性重放不产生重复项）', () => {
    const { dbPath } = buildPreBackfillDb([{ id: 'bf-replay', tools: '[]' }]);
    // 找到回填条目（同 preBackfillMigrations 的定位律，不写死序号）。
    const entry = readJournal(MIGRATIONS_FOLDER).entries.find((e) =>
      /json_insert\(`?tools`?.*'推送分支'/i.test(
        readFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), 'utf8'),
      ),
    )!;
    const backfillSql = readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8');
    const sqlite = new Database(dbPath);
    sqlite.exec(backfillSql);
    sqlite.exec(backfillSql); // 双跑
    sqlite.close();
    expect(readTools(dbPath, 'bf-replay')).toEqual(['推送分支']);
  });
});
