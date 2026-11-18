import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

const dropIndex = journal.entries.findIndex((entry) => entry.tag.endsWith('_retire_chief_digest'));
const PREV_TAG = journal.entries[dropIndex - 1]?.tag ?? '';

const TABLES = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chief_summary'";

function seed(sqlite: Database.Database, directory: string) {
  migrateUpTo(sqlite, directory, PREV_TAG);
  sqlite.exec(`
    INSERT INTO user (id, displayName) VALUES ('user', 'Owner');
    INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1);
    INSERT INTO chief (id, userId, teamId, tz, createdAt)
      VALUES ('chief', 'user', 'team', 'Asia/Singapore', 1);
    INSERT INTO chief_thread (id, chiefId, userId, teamId, title, sessionId, sessionOpenedAt, createdAt, updatedAt)
      VALUES ('chief-digest-chief', 'chief', 'user', 'team', 'Digest', '', 1, 1, 1);
    INSERT INTO chief_summary (threadId, summary, coveredThroughId, coveredAt, coveredRowid, compactedMessages, generation, updatedAt)
      VALUES ('thread', 'a stored summary', 'm9', 1, 9, 20, 1, 1);
    INSERT INTO step (id, buildId, kind, status, createdAt)
      VALUES ('digest-pending', 'chief-digest-chief', 'chief', 'pending', 1);
    INSERT INTO step (id, buildId, kind, status, claimedAt, createdAt)
      VALUES ('digest-claimed', 'chief-digest-chief', 'chief', 'claimed', 1, 1);
    INSERT INTO step (id, buildId, kind, status, createdAt)
      VALUES ('other-thread', 'chief-main', 'chief', 'pending', 1);
    INSERT INTO routing_rule (id, teamId, \`use\`, provider, modelId, createdAt, updatedAt)
      VALUES ('digest-route', 'team', 'digest', 'openai-codex', 'gpt-6.1-sol', 1, 1);
    INSERT INTO routing_rule (id, teamId, \`use\`, provider, modelId, createdAt, updatedAt)
      VALUES ('coordinator-route', 'team', 'coordinator', 'openai-codex', 'gpt-6.1-sol', 1, 1);
  `);
}

test('upgrade stops live digest steps, deletes digest rules and drops chief_summary', () => {
  const directory = makeTestTempDir('cairn-retire-chief-digest-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    sqlite.pragma('foreign_keys = ON');
    seed(sqlite, directory);
    migrateAll(sqlite);
    expect(sqlite.prepare(TABLES).all()).toEqual([]);
    for (const kept of ['chief', 'chief_thread', 'chief_message', 'chief_turn_usage']) {
      expect(
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(kept),
      ).toEqual({ name: kept });
    }
    expect(
      sqlite.prepare("SELECT id, status FROM step WHERE id LIKE 'digest-%' ORDER BY id").all(),
    ).toEqual([
      { id: 'digest-claimed', status: 'stopped' },
      { id: 'digest-pending', status: 'stopped' },
    ]);
    expect(
      sqlite.prepare("SELECT id, status FROM step WHERE id NOT LIKE 'digest-%' ORDER BY id").all(),
    ).toEqual([{ id: 'other-thread', status: 'pending' }]);
    expect(sqlite.prepare('SELECT id FROM routing_rule ORDER BY id').all()).toEqual([
      { id: 'coordinator-route' },
    ]);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a failed drop leaves the batch aborted', () => {
  const directory = makeTestTempDir('cairn-retire-chief-digest-abort-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    sqlite.pragma('foreign_keys = ON');
    seed(sqlite, directory);
    sqlite.exec('DROP TABLE chief_summary');
    expect(() => migrateAll(sqlite)).toThrow();
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fresh migration builds a database without chief_summary', () => {
  const directory = makeTestTempDir('cairn-retire-chief-digest-fresh-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateAll(sqlite);
    expect(sqlite.prepare(TABLES).all()).toEqual([]);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
