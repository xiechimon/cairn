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
  '%s migration adds nullable archivedAt and preserves task phases',
  (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'cairn-archive-migration-'));
    const sqlite = new Database(join(directory, 'db.sqlite'));
    const db = drizzle(sqlite);
    try {
      const cut = journal.entries.findIndex((entry) => entry.tag.endsWith('_todo_archive'));
      expect(cut).toBeGreaterThan(0);
      expect(journal.entries[cut]!.when).toBeGreaterThan(journal.entries[cut - 1]!.when);
      const prior = join(directory, 'prior');
      mkdirSync(join(prior, 'meta'), { recursive: true });
      const entries = journal.entries.slice(0, cut);
      writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
      for (const entry of entries)
        copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
      migrate(db, { migrationsFolder: mode === 'upgrade' ? prior : MIGRATIONS_FOLDER });
      sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('retained', 'Retained', 1)");
      sqlite.exec(
        "INSERT INTO project (id, teamId, name) VALUES ('project', 'retained', 'Project')",
      );
      sqlite.exec(
        "INSERT INTO todo (id, teamId, projectId, title, phase, phaseAt, seqNum) VALUES ('task', 'retained', 'project', 'Task', 'done', 42, 1)",
      );
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(sqlite.prepare('SELECT phase, phaseAt, archivedAt FROM todo').get()).toEqual({
        phase: 'done',
        phaseAt: 42,
        archivedAt: null,
      });
      expect(
        sqlite
          .prepare("SELECT name FROM pragma_table_info('step') WHERE name = 'archiveStop'")
          .get(),
      ).toEqual({ name: 'archiveStop' });
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()).toEqual(
        [],
      );
      sqlite.exec('UPDATE todo SET archivedAt = 123');
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(sqlite.prepare('SELECT phase, archivedAt FROM todo').get()).toEqual({
        phase: 'done',
        archivedAt: 123,
      });
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test('migration journal keeps its trailing newline', () => {
  expect(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8').endsWith('\n')).toBe(
    true,
  );
});
