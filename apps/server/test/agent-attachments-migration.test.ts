import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, test } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { tag: string; when: number }[];
};

test.each(['fresh', 'upgrade'])(
  '%s migration adds nullable agent attachment provenance without losing human files',
  (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'cairn-agent-attachment-migration-'));
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite);
    try {
      const cut = journal.entries.findIndex((entry) => entry.tag.endsWith('_agent_attachments'));
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
      sqlite.exec(
        "INSERT INTO attachment (id, teamId, createdBy, fileName, mimeType, sizeBytes, storageKey, grantId, scope, status, createdAt) VALUES ('human', 'team', 'user', 'report.txt', 'text/plain', 1, 'team/human.txt', 'grant', 'message', 'ready', 1)",
      );
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(sqlite.prepare('SELECT id, status, todoId, sha256 FROM attachment').get()).toEqual({
        id: 'human',
        status: 'ready',
        todoId: null,
        sha256: null,
      });
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()).toEqual(
        [],
      );
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
