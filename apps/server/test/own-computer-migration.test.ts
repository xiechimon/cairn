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

test('dropping the own-computer switch retires its approvals and keeps other proposals', () => {
  const directory = makeTestTempDir('cairn-own-computer-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  const db = drizzle(sqlite);
  try {
    const cut = journal.entries.findIndex((entry) =>
      entry.tag.endsWith('_drop_own_computer_switch'),
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
      "INSERT INTO machine (id, teamId, name, online, lastSeenAt, ownComputerEnabled) VALUES ('mac', 'team', 'users-mac', 1, 1, 1)",
    );
    const insert = sqlite.prepare(
      "INSERT INTO action_proposal (id, teamId, actionId, targetId, inputJson, inputHash, status, expiresAt, createdAt) VALUES (?, 'team', ?, 't', '{}', 'h', ?, 9, 1)",
    );
    insert.run('app', 'user_computer.app', 'executed');
    insert.run('shell', 'user_computer.shell', 'pending');
    insert.run('other', 'project.delete', 'pending');
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(sqlite.prepare('SELECT id, status FROM action_proposal ORDER BY id').all()).toEqual([
      { id: 'app', status: 'superseded' },
      { id: 'other', status: 'pending' },
      { id: 'shell', status: 'superseded' },
    ]);
    expect(
      (sqlite.prepare('PRAGMA table_info(machine)').all() as { name: string }[]).map(
        (column) => column.name,
      ),
    ).not.toContain('ownComputerEnabled');
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
