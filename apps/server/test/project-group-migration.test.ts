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

test('project group migration preserves existing projects and defaults new projects to ungrouped', () => {
  const directory = makeTestTempDir('cairn-project-group-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  const db = drizzle(sqlite);
  try {
    const cut = journal.entries.findIndex((entry) => entry.tag.endsWith('_project_group'));
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
    sqlite.exec("INSERT INTO project (id, name, teamId) VALUES ('existing', 'Existing', 'team')");
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.exec("INSERT INTO project (id, name, teamId) VALUES ('new', 'New', 'team')");
    expect(sqlite.prepare('SELECT id, name, `group` FROM project ORDER BY id').all()).toEqual([
      { id: 'existing', name: 'Existing', group: null },
      { id: 'new', name: 'New', group: null },
    ]);
    sqlite.exec("UPDATE project SET `group` = 'Side projects' WHERE id = 'existing'");
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(sqlite.prepare("SELECT `group` FROM project WHERE id = 'existing'").get()).toEqual({
      group: 'Side projects',
    });
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
