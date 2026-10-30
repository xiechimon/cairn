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
  '%s queue migration preserves builds and cascades queued messages',
  (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'cairn-queue-migration-'));
    const sqlite = new Database(join(directory, 'db.sqlite'));
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    try {
      const cut = journal.entries.findIndex((entry) => entry.tag.endsWith('_queued_message'));
      expect(cut).toBeGreaterThan(0);
      expect(journal.entries[cut]!.when).toBeGreaterThan(journal.entries[cut - 1]!.when);
      const prior = join(directory, 'prior');
      mkdirSync(join(prior, 'meta'), { recursive: true });
      const entries = journal.entries.slice(0, cut);
      writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
      for (const entry of entries)
        copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
      migrate(db, { migrationsFolder: mode === 'upgrade' ? prior : MIGRATIONS_FOLDER });
      sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)");
      sqlite.exec("INSERT INTO project (id, teamId, name) VALUES ('project', 'team', 'Project')");
      sqlite.exec(
        "INSERT INTO todo (id, teamId, projectId, title, phaseAt, seqNum) VALUES ('task', 'team', 'project', 'Task', 1, 1)",
      );
      sqlite.exec(
        "INSERT INTO build (id, todoId, withPlan, triggerSource, createdAt) VALUES ('build', 'task', 0, 'user', 1)",
      );
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      sqlite.exec(
        "INSERT INTO queued_message (id, conversationId, content, createdAt) VALUES ('queued', 'build', 'Next turn', 2)",
      );
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(
        sqlite.prepare('SELECT content, deliverAfterStop, error FROM queued_message').all(),
      ).toEqual([{ content: 'Next turn', deliverAfterStop: 0, error: null }]);
      sqlite.exec(
        "UPDATE queued_message SET deliverAfterStop = 1, error = 'Task cannot accept a message'",
      );
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(sqlite.prepare('SELECT deliverAfterStop, error FROM queued_message').get()).toEqual({
        deliverAfterStop: 1,
        error: 'Task cannot accept a message',
      });
      sqlite.exec("DELETE FROM build WHERE id = 'build'");
      expect(sqlite.prepare('SELECT * FROM queued_message').all()).toEqual([]);
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()).toEqual(
        [],
      );
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
