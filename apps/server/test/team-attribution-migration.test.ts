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

test('attribution migration gives existing teams the same defaults as new teams', () => {
  const directory = makeTestTempDir('cairn-attribution-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  const db = drizzle(sqlite);
  try {
    const cut = journal.entries.findIndex((entry) =>
      entry.tag.endsWith('_team_attribution_settings'),
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
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('existing', 'Existing', 1)");
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('new', 'New', 2)");
    expect(
      sqlite.prepare('SELECT coAuthorTrailer, requestInstructorReview FROM team ORDER BY id').all(),
    ).toEqual([
      { coAuthorTrailer: 1, requestInstructorReview: 0 },
      { coAuthorTrailer: 1, requestInstructorReview: 0 },
    ]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
