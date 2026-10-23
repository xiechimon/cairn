// spec 13 升级护栏（#367 T1 skill + #368 T2 mcp_server 合流）：两张登记制表在
// drop migration 应用**前**把现存行导出到 `<legacyExportDir>/legacy-export-<ts>.json`
// （release note 指向的保底副本），再清 agent 授权列（skills / mcpServers 清为
// '[]'——旧 id/slug 随表失效，死引用不留），最后 DROP TABLE。
//
// 导出发生在 openDbWithHandle 的 migrate 之前（pre-migration 钩子），仅当旧库
// 里表仍存在且有行时落盘——新库/已迁移库/空表 = 不落（噪音闸）。
//
// 失败方式先行枚举——
// L1 旧库（两表各有行 + agent 两列死引用）→ 打开即迁移：两表消失 / agent
//    skills 与 mcpServers 均为 '[]' / legacy-export-*.json 恰一份且两表行齐
//    （skill.files 还原为对象；mcp_server.credentialKeys/args 还原；headersCipher
//    保持密文——明文永不扩散）。
// L2 旧库两表零行 → 不落文件，表照删。
// L3 全新库（0000 建表 → 同轮 drop）→ 干净迁移、不落文件。
// L4 未传 legacyExportDir（内存测试形态）→ 不落文件、迁移照常。
// L5 文件名形 = legacy-export-<ISO ts 冒号点换连字符>.json；二次启动幂等（表已
//    drop = 不再产出第二份）。
// L6 :memory: → 不尝试导出、不炸。

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, describe, expect, test } from 'vitest';
import { MIGRATIONS_FOLDER, openDbWithHandle, openMemoryDb } from '../src/db/client.js';
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

// —— 旧库构造（migration 序号不写死——撞号纪律：按「含 DROP 退役表的那条」定位，
// 合并期重编号后本测试零改动）———————————————————————————————————————————————

function readJournal(folder: string): { entries: { idx: number; tag: string }[] } {
  return JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'));
}

/** 复制 migrations 目录并截掉「第一条 drop 退役表起」的尾部 = 升级前旧库形态
 * （两票的 drop 都在尾部；截最早一条 = 两表俱在）。 */
function trimmedMigrations(): string {
  const journal = readJournal(MIGRATIONS_FOLDER);
  const dropIdx = journal.entries.findIndex((entry) =>
    /DROP TABLE\s+`?(skill|mcp_server)`?/i.test(
      readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8'),
    ),
  );
  expect(dropIdx, 'journal 里找不到 drop 退役表的 migration').toBeGreaterThan(0);
  const dir = temp('cairn-migrations-old-');
  mkdirSync(join(dir, 'meta'));
  for (const entry of journal.entries.slice(0, dropIdx)) {
    cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
    // snapshot 文件随带（drizzle-kit 链校验用；runtime migrator 只读 journal+sql）
    const snapshot = join(MIGRATIONS_FOLDER, 'meta', `${entry.tag}_snapshot.json`);
    try {
      cpSync(snapshot, join(dir, 'meta', `${entry.tag}_snapshot.json`));
    } catch {
      /* 0008 型 snapshot 缺位先例（db-check.mjs 注）：跳过可接受 */
    }
  }
  writeJournal(dir, journal.entries.slice(0, dropIdx));
  return dir;
}

function writeJournal(dir: string, entries: { idx: number; tag: string }[]): void {
  const full = readJournal(MIGRATIONS_FOLDER);
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify(
      { ...full, entries: entries.map((e) => full.entries.find((f) => f.tag === e.tag)) },
      null,
      2,
    ),
  );
}

interface LegacyWorld {
  dbPath: string;
}

/** 建旧库：迁移到 drop 前 + seed team + 插两表行与带死引用的 agent 行。 */
function buildLegacyDb(opts: { skillRows?: number; mcpRows?: number } = {}): LegacyWorld {
  const skillRows = opts.skillRows ?? 2;
  const mcpRows = opts.mcpRows ?? 1;
  const dir = temp('cairn-legacy-db-');
  const dbPath = join(dir, 'server.db');
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: trimmedMigrations() });
  const { team } = seed(db);
  const insertSkill = sqlite.prepare(
    'INSERT INTO skill (id, teamId, name, description, files) VALUES (?, ?, ?, ?, ?)',
  );
  for (let i = 1; i <= skillRows; i++) {
    insertSkill.run(
      `sk-${i}`,
      team.id,
      `技能${i}`,
      i === 1 ? '旧库描述' : null,
      JSON.stringify({ 'SKILL.md': `# 技能${i}\n内容`, 'helper.sh': 'echo hi' }),
    );
  }
  const insertMcp = sqlite.prepare(
    `INSERT INTO mcp_server (id, teamId, label, slug, transport, url, hasCredential, credentialKeys, command, args, headersCipher, createdBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 1; i <= mcpRows; i++) {
    insertMcp.run(
      `m-${i}`,
      team.id,
      `服务${i}`,
      `demo-${i}`,
      'http',
      'https://x.invalid/mcp',
      1,
      JSON.stringify(['Authorization']),
      null,
      JSON.stringify([]),
      'cipher-text',
      'member-seed',
      1,
      1,
    );
  }
  sqlite
    .prepare(
      'INSERT INTO agent (id, teamId, displayName, skills, mcpServers) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      'ag-1',
      team.id,
      '旧 Agent',
      JSON.stringify(['sk-1', 'sk-gone']),
      JSON.stringify(['demo-1']),
    );
  sqlite.close();
  return { dbPath };
}

function tableExists(dbPath: string, table: string): boolean {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    const row = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    return row !== undefined;
  } finally {
    sqlite.close();
  }
}

function agentColumn(
  dbPath: string,
  agentId: string,
  column: 'defaultSkill' | 'skillsAllowlist' | 'mcpServers',
): string | null {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    const row = sqlite.prepare(`SELECT ${column} FROM agent WHERE id = ?`).get(agentId) as Record<
      string,
      string | null
    >;
    return row[column] ?? null;
  } finally {
    sqlite.close();
  }
}

function exportFiles(homeDir: string): string[] {
  return readdirSync(homeDir)
    .filter((f) => /^legacy-export-.+\.json$/.test(f))
    .sort();
}

// —— 用例 ————————————————————————————————————————————————————————————————————

describe('legacy-export 迁移护栏（skill + mcp_server 表退役）', () => {
  test('L1/L5：旧库两表有行 → 导出落盘内容齐、mcpServers 清空 + skills 列迁移退役、两表消失', () => {
    const { dbPath } = buildLegacyDb({ skillRows: 2, mcpRows: 1 });
    const home = temp('cairn-legacy-home-');
    const { db, close } = openDbWithHandle(dbPath, { legacyExportDir: home });
    try {
      expect(tableExists(dbPath, 'skill')).toBe(false);
      expect(tableExists(dbPath, 'mcp_server')).toBe(false);
      // #1169：skills 列由 0034 读取迁移后 DROP；0013 已把旧值清成 '[]'，按票面
      // 条文 [] → skillsAllowlist NULL（不限制）、defaultSkill null。mcpServers
      // 清空（#368）不受影响。
      expect(agentColumn(dbPath, 'ag-1', 'skillsAllowlist')).toBeNull();
      expect(agentColumn(dbPath, 'ag-1', 'defaultSkill')).toBeNull();
      expect(agentColumn(dbPath, 'ag-1', 'mcpServers')).toBe('[]');
      const files = exportFiles(home);
      expect(files).toHaveLength(1);
      // L5 文件名形：legacy-export-<ISO ts>.json（冒号/点已换连字符，跨平台安全）
      expect(files[0]).toMatch(/^legacy-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
      const body = JSON.parse(readFileSync(join(home, files[0] ?? ''), 'utf8')) as {
        exportedAt: number;
        tables: {
          skill: { id: string; name: string; files: Record<string, string> }[];
          mcp_server: Record<string, unknown>[];
        };
      };
      expect(typeof body.exportedAt).toBe('number');
      expect(body.tables.skill).toHaveLength(2);
      const firstSkill = body.tables.skill.find((r) => r.id === 'sk-1');
      expect(firstSkill).toBeDefined();
      expect(firstSkill?.name).toBe('技能1');
      // files 列还原为对象（导出 = 人可读保底副本，非 JSON 字符串套娃）
      expect(firstSkill?.files).toEqual({ 'SKILL.md': '# 技能1\n内容', 'helper.sh': 'echo hi' });
      // mcp_server：JSON 列还原、密文列保持密文（明文永不扩散）
      expect(body.tables.mcp_server).toHaveLength(1);
      expect(body.tables.mcp_server[0]).toMatchObject({
        id: 'm-1',
        slug: 'demo-1',
        url: 'https://x.invalid/mcp',
        credentialKeys: ['Authorization'],
        args: [],
        headersCipher: 'cipher-text',
      });
      // 迁移后的库可正常查询（drizzle 面回归）
      expect(db).toBeDefined();
    } finally {
      close();
    }
  });

  test('L2：旧库两表零行 → 不落文件，表照删', () => {
    const { dbPath } = buildLegacyDb({ skillRows: 0, mcpRows: 0 });
    const home = temp('cairn-legacy-home-');
    const { close } = openDbWithHandle(dbPath, { legacyExportDir: home });
    try {
      expect(tableExists(dbPath, 'skill')).toBe(false);
      expect(tableExists(dbPath, 'mcp_server')).toBe(false);
      expect(exportFiles(home)).toEqual([]);
    } finally {
      close();
    }
  });

  test('L3：全新库 → 干净迁移、不落文件（同轮建表即删不算升级数据）', () => {
    const dir = temp('cairn-fresh-db-');
    const dbPath = join(dir, 'server.db');
    const home = temp('cairn-legacy-home-');
    const { close } = openDbWithHandle(dbPath, { legacyExportDir: home });
    try {
      expect(tableExists(dbPath, 'skill')).toBe(false);
      expect(tableExists(dbPath, 'mcp_server')).toBe(false);
      expect(exportFiles(home)).toEqual([]);
    } finally {
      close();
    }
  });

  test('L4：未传 legacyExportDir（内存/测试形态）→ 不落文件、迁移照常', () => {
    const { dbPath } = buildLegacyDb({ skillRows: 1, mcpRows: 1 });
    const { close } = openDbWithHandle(dbPath);
    try {
      expect(tableExists(dbPath, 'skill')).toBe(false);
      expect(tableExists(dbPath, 'mcp_server')).toBe(false);
      // #1169：skills 列由 0034 读取迁移后 DROP；0013 已把旧值清成 '[]'，按票面
      // 条文 [] → skillsAllowlist NULL（不限制）、defaultSkill null。mcpServers
      // 清空（#368）不受影响。
      expect(agentColumn(dbPath, 'ag-1', 'skillsAllowlist')).toBeNull();
      expect(agentColumn(dbPath, 'ag-1', 'defaultSkill')).toBeNull();
      expect(agentColumn(dbPath, 'ag-1', 'mcpServers')).toBe('[]');
    } finally {
      close();
    }
  });

  test('L5b：二次启动幂等——表已 drop = 不再产出第二份', () => {
    const { dbPath } = buildLegacyDb({ skillRows: 1, mcpRows: 1 });
    const home = temp('cairn-legacy-home-');
    openDbWithHandle(dbPath, { legacyExportDir: home }).close();
    openDbWithHandle(dbPath, { legacyExportDir: home }).close();
    expect(existsSync(dbPath)).toBe(true);
    expect(exportFiles(home)).toHaveLength(1);
  });

  test('L6：:memory: 不尝试导出、不炸', () => {
    expect(() => openMemoryDb()).not.toThrow();
  });
});
