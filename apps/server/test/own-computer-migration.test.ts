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

test('an existing machine reads the own-computer switch as off after the migration', () => {
  const directory = makeTestTempDir('cairn-own-computer-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  const db = drizzle(sqlite);
  try {
    const cut = journal.entries.findIndex((entry) =>
      entry.tag.endsWith('_machine_own_computer_enabled'),
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
      "INSERT INTO machine (id, teamId, name, online, lastSeenAt, capabilities) VALUES ('mac', 'team', 'ians-mac', 1, 1, '{\"ownComputerHost\":true}')",
    );
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(
      sqlite.prepare('SELECT ownComputerEnabled FROM machine WHERE id = ?').get('mac'),
    ).toEqual({
      ownComputerEnabled: 0,
    });
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
