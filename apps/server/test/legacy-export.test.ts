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
import { insertLegacyUserAndTeam } from './helpers.js';

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

function trimmedMigrations(): string {
  const journal = readJournal(MIGRATIONS_FOLDER);
  const dropIdx = journal.entries.findIndex((entry) =>
    /DROP TABLE\s+`?(skill|mcp_server)`?/i.test(
      readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8'),
    ),
  );
  expect(dropIdx, 'drop retired-table migration missing from journal').toBeGreaterThan(0);
  const dir = temp('cairn-migrations-old-');
  mkdirSync(join(dir, 'meta'));
  for (const entry of journal.entries.slice(0, dropIdx)) {
    cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
    const snapshot = join(MIGRATIONS_FOLDER, 'meta', `${entry.tag}_snapshot.json`);
    try {
      cpSync(snapshot, join(dir, 'meta', `${entry.tag}_snapshot.json`));
    } catch {}
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

function buildLegacyDb(opts: { skillRows?: number; mcpRows?: number } = {}): LegacyWorld {
  const skillRows = opts.skillRows ?? 2;
  const mcpRows = opts.mcpRows ?? 1;
  const dir = temp('cairn-legacy-db-');
  const dbPath = join(dir, 'server.db');
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: trimmedMigrations() });
  const { teamId } = insertLegacyUserAndTeam(sqlite, {
    userId: 'user-legacy',
    teamId: 'team-legacy',
  });
  const insertSkill = sqlite.prepare(
    'INSERT INTO skill (id, teamId, name, description, files) VALUES (?, ?, ?, ?, ?)',
  );
  for (let i = 1; i <= skillRows; i++) {
    insertSkill.run(
      `sk-${i}`,
      teamId,
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
      teamId,
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
      teamId,
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

describe('legacy-export migration guardrail (skill + mcp_server table retirement)', () => {
  test('L1/L5: legacy db two tables with rows -> export content complete on disk, mcpServers cleared + skills column migration retired, both tables gone', () => {
    const { dbPath } = buildLegacyDb({ skillRows: 2, mcpRows: 1 });
    const home = temp('cairn-legacy-home-');
    const { db, close } = openDbWithHandle(dbPath, { legacyExportDir: home });
    try {
      expect(tableExists(dbPath, 'skill')).toBe(false);
      expect(tableExists(dbPath, 'mcp_server')).toBe(false);
      expect(agentColumn(dbPath, 'ag-1', 'skillsAllowlist')).toBeNull();
      expect(agentColumn(dbPath, 'ag-1', 'defaultSkill')).toBeNull();
      expect(agentColumn(dbPath, 'ag-1', 'mcpServers')).toBe('[]');
      const files = exportFiles(home);
      expect(files).toHaveLength(1);
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
      expect(firstSkill?.files).toEqual({ 'SKILL.md': '# 技能1\n内容', 'helper.sh': 'echo hi' });
      expect(body.tables.mcp_server).toHaveLength(1);
      expect(body.tables.mcp_server[0]).toMatchObject({
        id: 'm-1',
        slug: 'demo-1',
        url: 'https://x.invalid/mcp',
        credentialKeys: ['Authorization'],
        args: [],
        headersCipher: 'cipher-text',
      });
      expect(db).toBeDefined();
    } finally {
      close();
    }
  });

  test('L2: legacy db two tables zero rows -> no file, tables still dropped', () => {
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

  test('L3: fresh db -> clean migration, no file (building then dropping tables in the same round is not upgrade data)', () => {
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

  test('L4: no legacyExportDir passed (in-memory/test form) -> no file, migration as usual', () => {
    const { dbPath } = buildLegacyDb({ skillRows: 1, mcpRows: 1 });
    const { close } = openDbWithHandle(dbPath);
    try {
      expect(tableExists(dbPath, 'skill')).toBe(false);
      expect(tableExists(dbPath, 'mcp_server')).toBe(false);
      expect(agentColumn(dbPath, 'ag-1', 'skillsAllowlist')).toBeNull();
      expect(agentColumn(dbPath, 'ag-1', 'defaultSkill')).toBeNull();
      expect(agentColumn(dbPath, 'ag-1', 'mcpServers')).toBe('[]');
    } finally {
      close();
    }
  });

  test('L5b: second boot idempotent -- tables already dropped = no second artifact', () => {
    const { dbPath } = buildLegacyDb({ skillRows: 1, mcpRows: 1 });
    const home = temp('cairn-legacy-home-');
    openDbWithHandle(dbPath, { legacyExportDir: home }).close();
    openDbWithHandle(dbPath, { legacyExportDir: home }).close();
    expect(existsSync(dbPath)).toBe(true);
    expect(exportFiles(home)).toHaveLength(1);
  });

  test('L6: :memory: does not attempt an export, does not blow up', () => {
    expect(() => openMemoryDb()).not.toThrow();
  });
});
