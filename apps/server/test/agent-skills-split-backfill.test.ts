import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, describe, expect, test } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
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

const SPLIT_MARKER = /json_extract\(`?skills`?\b/i;

function findSplitEntry(): { tag: string } {
  const entry = readJournal(MIGRATIONS_FOLDER).entries.find((e) =>
    SPLIT_MARKER.test(readFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), 'utf8')),
  );
  expect(entry, 'skills split-field backfill migration missing from journal').toBeTruthy();
  return entry!;
}

function preSplitMigrations(): string {
  const journal = readJournal(MIGRATIONS_FOLDER);
  const splitIdx = journal.entries.findIndex((entry) => entry.tag === findSplitEntry().tag);
  expect(splitIdx, 'split-field migration should be in the journal').toBeGreaterThan(0);
  const dir = temp('cairn-migrations-pre-split-');
  mkdirSync(join(dir, 'meta'));
  for (const entry of journal.entries.slice(0, splitIdx)) {
    cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
    const snapshot = join(MIGRATIONS_FOLDER, 'meta', `${entry.tag}_snapshot.json`);
    try {
      cpSync(snapshot, join(dir, 'meta', `${entry.tag}_snapshot.json`));
    } catch {}
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

function buildPreSplitDb(rows: LegacyAgent[]): { dbPath: string } {
  const dir = temp('cairn-split-db-');
  const dbPath = join(dir, 'server.db');
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: preSplitMigrations() });
  const { teamId } = insertLegacyUserAndTeam(sqlite, {
    userId: 'user-legacy',
    teamId: 'team-legacy',
  });
  const insert = sqlite.prepare(
    'INSERT INTO agent (id, teamId, displayName, tools, secrets, skills, mcpServers) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const row of rows) {
    insert.run(row.id, teamId, `存量-${row.id}`, '[]', '[]', row.skills, '[]');
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
  return {
    defaultSkill: row.defaultSkill,
    skillsAllowlist: row.skillsAllowlist === null ? null : JSON.parse(row.skillsAllowlist),
  };
}

describe('#1169 skills split-field backfill (legacy rows preserved + [] -> null repairs crippled rows)', () => {
  test('pre-upgrade legacy db -> full backfill migration rerun: S1-S4 all pass', () => {
    const { dbPath } = buildPreSplitDb([
      { id: 'sp-empty', skills: '[]' },
      { id: 'sp-single', skills: '["deploy"]' },
      { id: 'sp-multi', skills: '["alpha","beta"]' },
    ]);
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.close();

    expect(readSplit(dbPath, 'sp-empty')).toEqual({ defaultSkill: null, skillsAllowlist: null });
    expect(readSplit(dbPath, 'sp-single')).toEqual({
      defaultSkill: 'deploy',
      skillsAllowlist: ['deploy'],
    });
    expect(readSplit(dbPath, 'sp-multi')).toEqual({
      defaultSkill: 'alpha',
      skillsAllowlist: ['alpha', 'beta'],
    });
    const cols = new Database(dbPath, { readonly: true })
      .prepare("SELECT name FROM pragma_table_info('agent')")
      .all()
      .map((c) => (c as { name: string }).name);
    expect(cols).not.toContain('skills');
    expect(cols).toContain('defaultSkill');
    expect(cols).toContain('skillsAllowlist');
  });

  test('S5: fresh db (0 agent rows) backfill is a no-op that does not blow up', () => {
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
