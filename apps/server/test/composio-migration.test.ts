import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';

const TAG = '0199_third_the_order';
const NEW_COLUMNS = ['toolsJson', 'composioSession', 'composioAccount'] as const;

type Journal = {
  entries: { idx: number; when: number; tag: string }[];
};

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function readJournal(): Journal {
  return JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'));
}

function columnNames(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (column) => column.name,
  );
}

function insertConnector(sqlite: Database.Database, status: string, authKind = 'none'): void {
  sqlite
    .prepare(
      `INSERT INTO mcp_connector
      (id, teamId, slug, label, url, headerNames, authKind, status, createdAt, updatedAt)
      VALUES ('conn-1', 't', 'github', 'GitHub', 'https://mcp.test/x', '[]', ?, ?, 1, 1)`,
    )
    .run(authKind, status);
}

test('the connector-fabric migration preserves rows and adds the composio columns', () => {
  const journal = readJournal();
  const entry = journal.entries.find((item) => item.tag === TAG);
  if (entry === undefined) throw new Error(`${TAG} missing from journal`);
  const earlier = journal.entries.filter((item) => item.idx < entry.idx);
  expect(entry.when).toBeGreaterThan(Math.max(...earlier.map((item) => item.when)));

  const cut = journal.entries.findIndex((item) => item.tag === TAG);
  const prior = makeTestTempDir('cairn-migrations-pre-composio-');
  temps.push(prior);
  mkdirSync(join(prior, 'meta'));
  for (const item of journal.entries.slice(0, cut)) {
    cpSync(join(MIGRATIONS_FOLDER, `${item.tag}.sql`), join(prior, `${item.tag}.sql`));
  }
  writeFileSync(
    join(prior, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
  );

  const sqlite = new Database(':memory:');
  try {
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: prior });
    const before = columnNames(sqlite, 'mcp_connector');
    for (const name of NEW_COLUMNS) expect(before).not.toContain(name);
    sqlite.prepare("INSERT INTO team (id,name,createdAt) VALUES ('t','team',1)").run();
    insertConnector(sqlite, 'connected');
    expect(() => insertConnector(sqlite, 'revoked')).toThrow();
    expect(() => insertConnector(sqlite, 'connected', 'composio')).toThrow();

    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const after = columnNames(sqlite, 'mcp_connector');
    for (const name of NEW_COLUMNS) expect(after).toContain(name);
    const row = sqlite.prepare('SELECT * FROM mcp_connector').get() as Record<string, unknown>;
    expect(row).toMatchObject({ slug: 'github', status: 'connected' });
    expect(row.toolsJson).toBeNull();
    expect(row.composioSession).toBeNull();
    expect(row.composioAccount).toBeNull();
    sqlite.prepare('DELETE FROM mcp_connector').run();
    insertConnector(sqlite, 'revoked');
    sqlite.prepare('DELETE FROM mcp_connector').run();
    insertConnector(sqlite, 'connected', 'composio');
    expect(() => insertConnector(sqlite, 'bogus')).toThrow();
  } finally {
    sqlite.close();
  }
});
