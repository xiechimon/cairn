// schema 面对拍：表清单 = shared DB_TABLES 单源（01 §6 锁定清单，24 record
// 投影表 + todo_tag join 表）；migration 可干净应用（openMemoryDb 走同一
// drizzle/ 目录）；seed 幂等（02 §2 恒一行）。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DB_TABLES } from '@pacman/shared';
import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, test } from 'vitest';
import { MIGRATIONS_FOLDER, openMemoryDb } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';

describe('37 表 migration（01 §6 清单）', () => {
  test('drizzle schema 表名集 = DB_TABLES', () => {
    const tables = Object.values(schema).filter((v) => is(v, SQLiteTable));
    const names = tables.map((t) => getTableConfig(t as SQLiteTable).name).sort();
    expect(names).toEqual([...DB_TABLES].sort());
    expect(names).toHaveLength(38); // 01 §6 原清单 30（含 skill/mcp_server/document_diff）− skill/mcp_server（spec 13 退役）− document_diff（#1029 死 schema：diff 端点自 plan 行现算，从未写入）+ spec 12 github_connection（内部凭证表）+ skill_audit（XMON-109 写审计）+ XMON-108 shell_command（内部审计表）+ #1137 webhook_token（内部凭证表）+ #1404 gate_digest/gate_round/gate_verdict/gate_state（合并就绪闸内部表）+ #1491 autonomy_state/member_activity（触发闸内部表）
    expect(names).toContain('chief');
    expect(names).toContain('attachment');
    expect(names).toContain('branch_sync');
    expect(names).toContain('github_connection');
    expect(names).toContain('shell_command');
    expect(names).toContain('gate_verdict');
  });

  test('migration SQL 进 repo 且全表覆盖（跨 migration 累计）', () => {
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

  test('migration 干净应用到内存库', () => {
    expect(() => openMemoryDb()).not.toThrow();
  });
});

describe('seed（02 §2 单用户 + team 保形恒一行）', () => {
  test('幂等：二次 seed 返回同一 user/team', () => {
    const db = openMemoryDb();
    const first = seed(db);
    const second = seed(db);
    expect(second.user.id).toBe(first.user.id);
    expect(second.team.id).toBe(first.team.id);
    expect(first.team.plan).toBe('free'); // 形状保留、不参与门控（A3）
  });
});
