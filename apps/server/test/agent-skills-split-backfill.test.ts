// #1169 agent.skills 拆字段回填 migration：存量行 skills[] 原样进 skillsAllowlist，
// 但 **[] 行迁为 null**（解除「新建 agent 出生即全拒」——[] 历来只能由残缺写入面
// 产出，非用户有意，本票唯一的行为变更）；skills[0] 非空的行，该值进 defaultSkill。
//
// 失败方式（先于实现固化，仓测试纪律）：
// S1 [] 没转成 null → 迁移错向：存量残废行升级后照旧全拒（本票主修位失效）。
// S2 非空白名单被改写/重排/丢项 → 存量授权行为回归（零回归判据）。
// S3 skills[0] 非空但没进 defaultSkill → 携带语义在迁移路上丢失。
// S4 旧 skills 列残留 → 读到分裂真值（读写面已迁新名）。
// S5 迁移在空库（0 agent 行）上跑 → 应为无炸 no-op。
// （无 S6 双跑幂等项：本条含 DROP COLUMN，重放本身即炸——重放防线是
//  _journal 记账，不是 SQL 容错，不照抄 0018 的 json_insert 双跑判据。）
//
// 定位律承 0018 先例：按内容找「含 skillsAllowlist 回填 UPDATE 的那条」，
// 迁移序号不写死（撞号纪律：合并期重编号后零改动）。

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

/** 拆字段那条 migration 的定位判据：UPDATE 里 json_extract(`skills`) 回填——
 * 「UPDATE agent SET」形在 0013 起有先例，不够唯一，不能用。 */
const SPLIT_MARKER = /json_extract\(`?skills`?\b/i;

function findSplitEntry(): { tag: string } {
  const entry = readJournal(MIGRATIONS_FOLDER).entries.find((e) =>
    SPLIT_MARKER.test(readFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), 'utf8')),
  );
  expect(entry, 'journal 里找不到 skills 拆字段回填 migration').toBeTruthy();
  return entry!;
}

/** 复制 migrations 目录并截掉「拆字段那条」起 = 升级前旧库形态。 */
function preSplitMigrations(): string {
  const journal = readJournal(MIGRATIONS_FOLDER);
  const splitIdx = journal.entries.findIndex((entry) => entry.tag === findSplitEntry().tag);
  expect(splitIdx, '拆字段 migration 应在 journal 内').toBeGreaterThan(0);
  const dir = temp('cairn-migrations-pre-split-');
  mkdirSync(join(dir, 'meta'));
  for (const entry of journal.entries.slice(0, splitIdx)) {
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
    JSON.stringify({ ...full, entries: full.entries.slice(0, splitIdx) }, null, 2),
  );
  return dir;
}

interface LegacyAgent {
  id: string;
  skills: string;
}

/** 建拆字段前旧库 + seed team + 插 skills 四形态的 agent 行。 */
function buildPreSplitDb(rows: LegacyAgent[]): { dbPath: string } {
  const dir = temp('cairn-split-db-');
  const dbPath = join(dir, 'server.db');
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: preSplitMigrations() });
  const { team } = seed(db);
  const insert = sqlite.prepare(
    'INSERT INTO agent (id, teamId, displayName, tools, secrets, skills, mcpServers) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const row of rows) {
    insert.run(row.id, team.id, `存量-${row.id}`, '[]', '[]', row.skills, '[]');
  }
  sqlite.close();
  return { dbPath };
}

interface SplitRow {
  defaultSkill: string | null;
  skillsAllowlist: string | null;
}

function readSplit(dbPath: string, id: string): SplitRow {
  const sqlite = new Database(dbPath, { readonly: true });
  const row = sqlite
    .prepare('SELECT defaultSkill, skillsAllowlist FROM agent WHERE id = ?')
    .get(id) as { defaultSkill: string | null; skillsAllowlist: string | null };
  sqlite.close();
  // defaultSkill = 裸 text 列（字符串或 null）；skillsAllowlist = json 列
  // （裸 SQL 读出 JSON 文本，null 列原样 null）。
  return {
    defaultSkill: row.defaultSkill,
    skillsAllowlist: row.skillsAllowlist === null ? null : JSON.parse(row.skillsAllowlist),
  };
}

describe('#1169 skills 拆字段回填（存量不破坏 + [] → null 解残废）', () => {
  test('升级前旧库 → 补跑全量 migration：S1–S4 全过', () => {
    const { dbPath } = buildPreSplitDb([
      { id: 'sp-empty', skills: '[]' }, // 残缺写入面产出的空集（本票主修位）
      { id: 'sp-single', skills: '["deploy"]' }, // 残缺写入面的单值形
      { id: 'sp-multi', skills: '["alpha","beta"]' }, // 多元素白名单
    ]);
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.close();

    // S1：[] → null（不限制——全量可读，解除出生即残废）。
    expect(readSplit(dbPath, 'sp-empty')).toEqual({ defaultSkill: null, skillsAllowlist: null });
    // S3：skills[0] 非空进 defaultSkill；S2：白名单原样（序与成员零回归）。
    expect(readSplit(dbPath, 'sp-single')).toEqual({
      defaultSkill: 'deploy',
      skillsAllowlist: ['deploy'],
    });
    expect(readSplit(dbPath, 'sp-multi')).toEqual({
      defaultSkill: 'alpha',
      skillsAllowlist: ['alpha', 'beta'],
    });
    // S4：旧 skills 列已下线（读写面不再有此真值源）。
    const cols = new Database(dbPath, { readonly: true })
      .prepare("SELECT name FROM pragma_table_info('agent')")
      .all()
      .map((c) => (c as { name: string }).name);
    expect(cols).not.toContain('skills');
    expect(cols).toContain('defaultSkill');
    expect(cols).toContain('skillsAllowlist');
  });

  test('S5：全新库（0 agent 行）回填应为无炸 no-op', () => {
    const { dbPath } = buildPreSplitDb([]);
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite, { schema });
    expect(() => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })).not.toThrow();
    sqlite.close();
    expect(
      new Database(dbPath, { readonly: true }).prepare('SELECT COUNT(*) n FROM agent').get(),
    ).toEqual({ n: 0 });
  });
});
