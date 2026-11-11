import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

test('computer browserEnabled defaults to false and survives re-migration', () => {
  const directory = makeTestTempDir('cairn-computer-browser-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  const db = drizzle(sqlite);
  try {
    const cut = journal.entries.findIndex((entry) =>
      entry.tag.endsWith('_computer_browser_enabled'),
    );
    expect(cut).toBeGreaterThan(0);
    const prior = join(directory, 'prior');
    mkdirSync(join(prior, 'meta'), { recursive: true });
    const entries = journal.entries.slice(0, cut);
    writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) {
      copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
    }
    migrate(db, { migrationsFolder: prior });
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)");
    sqlite.exec(
      "INSERT INTO machine (id, teamId, name, online, lastSeenAt, capabilities) VALUES ('m1', 'team', 'omarchy', 1, 1, '{}')",
    );
    sqlite.exec(
      "INSERT INTO computer (id, teamId, scope, scopeKey, machineId, kind, providerRef, state, executionFence, controlHolder, controlFence, screenGeneration, createdAt, updatedAt) VALUES ('c1', 'team', 'private', 'chief:c1', 'm1', 'orb', 'ref', 'stopped', 0, 'none', 0, 0, 1, 1)",
    );
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(sqlite.prepare('SELECT browserEnabled FROM computer WHERE id = ?').get('c1')).toEqual({
      browserEnabled: 0,
    });
    sqlite.prepare('UPDATE computer SET browserEnabled = 1 WHERE id = ?').run('c1');
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(sqlite.prepare('SELECT browserEnabled FROM computer WHERE id = ?').get('c1')).toEqual({
      browserEnabled: 1,
    });
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('machine migration maps legacy on to explicit on and false to unset', () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(
      'CREATE TABLE machine (id TEXT PRIMARY KEY); CREATE TABLE computer (machineId TEXT, browserEnabled INTEGER);',
    );
    sqlite.exec(
      "INSERT INTO machine VALUES ('on'), ('off'); INSERT INTO computer VALUES ('on', 1), ('off', 0);",
    );
    const tag = journal.entries.find((entry) => entry.idx === 149)!.tag;
    sqlite.exec(
      readFileSync(join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      ),
    );
    expect(sqlite.prepare('SELECT * FROM machine ORDER BY id').all()).toEqual([
      { id: 'off', browserOverride: null, desktopOverride: null },
      { id: 'on', browserOverride: 1, desktopOverride: null },
    ]);
  } finally {
    sqlite.close();
  }
});
