import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

test('legacy db upgrade keeps all stored memories valid: three columns added but not filled', () => {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const cut = journal.entries.findIndex((entry) =>
    /ALTER TABLE `agent_memory` ADD `invalidAt`/.test(
      readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8'),
    ),
  );
  expect(cut, 'migration adding invalidAt missing from journal').toBeGreaterThan(0);
  const oldMigrations = makeTestTempDir('cairn-migrations-pre-invalidation-');
  mkdirSync(join(oldMigrations, 'meta'));
  for (const entry of journal.entries.slice(0, cut)) {
    cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(oldMigrations, `${entry.tag}.sql`));
  }
  writeFileSync(
    join(oldMigrations, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
  );
  const dir = makeTestTempDir('cairn-memory-legacy-');
  temps.push(oldMigrations, dir);
  const dbPath = join(dir, 'server.db');
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: oldMigrations });
  const { team } = seed(db);
  sqlite
    .prepare(
      'INSERT INTO agent_memory (id, agentId, teamId, title, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run('legacy-1', 'agent-1', team.id, '旧记忆', '升级前写入', 1, 1);

  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  expect(
    sqlite
      .prepare('SELECT invalidAt, supersededBy, lastInjectedAt FROM agent_memory WHERE id = ?')
      .get('legacy-1'),
  ).toEqual({ invalidAt: null, supersededBy: null, lastInjectedAt: null });
  sqlite.close();
});
