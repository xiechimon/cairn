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
  '%s migration adds nullable snoozedUntil and snoozeMode and keeps existing rows',
  (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'cairn-snooze-migration-'));
    const sqlite = new Database(join(directory, 'db.sqlite'));
    const db = drizzle(sqlite);
    try {
      const cut = journal.entries.findIndex((entry) => entry.tag.endsWith('_todo_snooze'));
      expect(cut).toBeGreaterThan(0);
      expect(journal.entries[cut]?.idx).toBe(81);
      expect(journal.entries[cut]?.when).toBeGreaterThan(journal.entries[cut - 1]?.when ?? 0);
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
      expect(
        sqlite.prepare('SELECT phase, phaseAt, snoozedUntil, snoozeMode FROM todo').get(),
      ).toEqual({
        phase: 'done',
        phaseAt: 42,
        snoozedUntil: null,
        snoozeMode: null,
      });
      const columns = sqlite
        .prepare(
          "SELECT name, type, \"notnull\" FROM pragma_table_info('todo') WHERE name IN ('snoozedUntil', 'snoozeMode') ORDER BY name",
        )
        .all();
      expect(columns).toEqual([
        { name: 'snoozeMode', type: 'TEXT', notnull: 0 },
        { name: 'snoozedUntil', type: 'INTEGER', notnull: 0 },
      ]);
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
