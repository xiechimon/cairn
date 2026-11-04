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
  '%s database puts existing and new teams on subscription-only',
  (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'cairn-routing-migration-'));
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite);
    try {
      const cut = journal.entries.findIndex((entry) => entry.tag.endsWith('_team_claude_usage'));
      expect(cut).toBeGreaterThan(0);
      expect(journal.entries[cut]!.when).toBeGreaterThan(journal.entries[cut - 1]!.when);
      if (mode === 'upgrade') {
        mkdirSync(join(directory, 'meta'));
        const entries = journal.entries.slice(0, cut);
        writeFileSync(
          join(directory, 'meta/_journal.json'),
          JSON.stringify({ ...journal, entries }),
        );
        for (const entry of entries)
          copyFileSync(
            join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
            join(directory, `${entry.tag}.sql`),
          );
        migrate(db, { migrationsFolder: directory });
        sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)");
      }
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      if (mode === 'upgrade') {
        expect(sqlite.prepare("SELECT claudeUsage FROM team WHERE id = 'team'").get()).toEqual({
          claudeUsage: 'subscription-only',
        });
        sqlite.exec("UPDATE team SET claudeUsage = 'allow-paid' WHERE id = 'team'");
      }
      sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('new-team', 'New team', 2)");
      expect(sqlite.prepare("SELECT claudeUsage FROM team WHERE id = 'new-team'").get()).toEqual({
        claudeUsage: 'subscription-only',
      });
      sqlite.exec("UPDATE team SET claudeUsage = 'allow-paid' WHERE id = 'new-team'");
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(sqlite.prepare("SELECT claudeUsage FROM team WHERE id = 'new-team'").get()).toEqual({
        claudeUsage: 'allow-paid',
      });
      if (mode === 'upgrade') {
        expect(sqlite.prepare("SELECT claudeUsage FROM team WHERE id = 'team'").get()).toEqual({
          claudeUsage: 'allow-paid',
        });
      }
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
