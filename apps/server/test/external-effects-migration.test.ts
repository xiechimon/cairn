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

test('external_effect, im_turn_origin and im_seen_inbound are created by the forward upgrade', () => {
  const directory = makeTestTempDir('cairn-effects-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  const db = drizzle(sqlite);
  try {
    const cut = journal.entries.findIndex((entry) => entry.tag.endsWith('_real_mathemanic'));
    expect(cut).toBeGreaterThan(0);
    const prior = join(directory, 'prior');
    mkdirSync(join(prior, 'meta'), { recursive: true });
    const entries = journal.entries.slice(0, cut);
    writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) {
      copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
    }
    migrate(db, { migrationsFolder: prior });
    for (const name of ['external_effect', 'im_turn_origin', 'im_seen_inbound']) {
      expect(
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(name),
      ).toBeUndefined();
    }
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)");
    sqlite.exec("INSERT INTO user (id, displayName) VALUES ('u', 'Owner')");
    sqlite.exec(
      "INSERT INTO im_connection (id, teamId, userId, platform, accountLabel, status, secretCipher, pairedSenders, createdAt, updatedAt) VALUES ('c1', 'team', 'u', 'telegram', 'bot', 'ready', 'cipher', '[]', 1, 1)",
    );
    sqlite.exec(
      "INSERT INTO external_effect (id, teamId, scopeKind, scopeId, kind, dedupeKey, payload, state, dueAt, attempts, createdAt, updatedAt) VALUES ('e1', 'team', 'step', 's1', 'im-send', 'dk1', '{}', 'pending', 1, 0, 1, 1)",
    );
    sqlite.exec(
      "INSERT INTO im_turn_origin (stepId, connId, chatKey, senderId, threadId, createdAt) VALUES ('s1', 'c1', 'chat', 'u1', 't1', 1)",
    );
    sqlite.exec(
      "INSERT INTO im_seen_inbound (connId, messageId, createdAt) VALUES ('c1', 'm1', 1)",
    );
    expect(() =>
      sqlite.exec(
        "INSERT INTO external_effect (id, teamId, scopeKind, scopeId, kind, dedupeKey, payload, state, dueAt, attempts, createdAt, updatedAt) VALUES ('e2', 'team', 'step', 's1', 'im-send', 'dk1', '{}', 'pending', 1, 0, 1, 1)",
      ),
    ).toThrow(/UNIQUE/);
    expect(() =>
      sqlite.exec(
        "INSERT INTO external_effect (id, teamId, scopeKind, scopeId, kind, dedupeKey, payload, state, dueAt, attempts, createdAt, updatedAt) VALUES ('e3', 'team', 'step', 's1', 'im-send', 'dk3', '{}', 'weird', 1, 0, 1, 1)",
      ),
    ).toThrow(/CHECK/);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(sqlite.prepare('SELECT state FROM external_effect WHERE id = ?').get('e1')).toEqual({
      state: 'pending',
    });
    expect(sqlite.prepare('SELECT chatKey FROM im_turn_origin WHERE stepId = ?').get('s1')).toEqual(
      { chatKey: 'chat' },
    );
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
