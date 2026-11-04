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

test.each(['fresh', 'upgrade'])(
  '%s database adds split policy and team pause while retaining existing data',
  (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'cairn-split-policy-'));
    const sqlite = new Database(join(directory, 'db.sqlite'));
    const db = drizzle(sqlite);
    try {
      const cut = journal.entries.findIndex((entry) => entry.tag.endsWith('_split_policy'));
      expect(cut).toBeGreaterThan(0);
      expect(journal.entries[cut]!.when).toBeGreaterThan(journal.entries[cut - 1]!.when);
      if (mode === 'upgrade') {
        const prior = join(directory, 'prior');
        mkdirSync(join(prior, 'meta'), { recursive: true });
        const entries = journal.entries.slice(0, cut);
        writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
        for (const entry of entries)
          copyFileSync(
            join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
            join(prior, `${entry.tag}.sql`),
          );
        migrate(db, { migrationsFolder: prior });
        sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('retained', 'Retained', 1)");
        sqlite.exec(
          "INSERT INTO project (id, teamId, name) VALUES ('retained-project', 'retained', 'Retained project')",
        );
      }
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      if (mode === 'fresh') {
        sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('retained', 'Retained', 1)");
        sqlite.exec(
          "INSERT INTO project (id, teamId, name) VALUES ('retained-project', 'retained', 'Retained project')",
        );
      }
      expect(
        sqlite.prepare("SELECT name, autonomyPaused FROM team WHERE id = 'retained'").get(),
      ).toEqual({ name: 'Retained', autonomyPaused: 0 });
      expect(
        sqlite.prepare("SELECT name, splitPolicy FROM project WHERE id = 'retained-project'").get(),
      ).toEqual({ name: 'Retained project', splitPolicy: 'human' });
      sqlite.exec("UPDATE team SET autonomyPaused = 1 WHERE id = 'retained'");
      sqlite.exec("UPDATE project SET splitPolicy = 'shadow' WHERE id = 'retained-project'");
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(sqlite.prepare("SELECT autonomyPaused FROM team WHERE id = 'retained'").get()).toEqual(
        { autonomyPaused: 1 },
      );
      expect(
        sqlite.prepare("SELECT splitPolicy FROM project WHERE id = 'retained-project'").get(),
      ).toEqual({ splitPolicy: 'shadow' });
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
