import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, test } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

test.each(['fresh', 'upgrade'])('%s database supports sealed subscription connections', (mode) => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-subscription-migration-'));
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite);
  try {
    const cut = journal.entries.findIndex((entry) => entry.tag.endsWith('_claude_subscription'));
    expect(cut).toBeGreaterThan(0);
    expect(journal.entries[cut]!.when).toBeGreaterThan(journal.entries[cut - 1]!.when);
    if (mode === 'upgrade') {
      mkdirSync(join(directory, 'meta'));
      const entries = journal.entries.slice(0, cut);
      writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
      for (const entry of entries)
        copyFileSync(
          join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
          join(directory, `${entry.tag}.sql`),
        );
      migrate(db, { migrationsFolder: directory });
      sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)");
    }
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    if (mode === 'fresh')
      sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)");
    sqlite.exec(
      "INSERT INTO claude_subscription (id, teamId, label, tokenCipher, expiresAt, createdAt) VALUES ('one', 'team', 'Personal', 'sealed-one', 200, 1), ('two', 'team', 'Work', 'sealed-two', NULL, 2)",
    );
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(
      sqlite
        .prepare('SELECT label, tokenCipher, expiresAt FROM claude_subscription ORDER BY createdAt')
        .all(),
    ).toEqual([
      { label: 'Personal', tokenCipher: 'sealed-one', expiresAt: 200 },
      { label: 'Work', tokenCipher: 'sealed-two', expiresAt: null },
    ]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
