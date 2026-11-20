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

const BEFORE_REBUILD =
  journal.entries[journal.entries.findIndex((entry) => entry.tag === '0195_short_ma_gnuci') - 1]
    ?.tag;
const BEFORE_IMESSAGE =
  journal.entries[journal.entries.findIndex((entry) => entry.tag === '0236_chubby_boom_boom') - 1]
    ?.tag;

function seedImGraph(sqlite: Database.Database, withImessageChildren: boolean) {
  sqlite.exec(`
    INSERT INTO user (id, displayName) VALUES ('user', 'Owner');
    INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1);
    INSERT INTO im_connection (id, teamId, userId, platform, accountLabel, secretCipher, status, createdAt, updatedAt)
      VALUES ('conn', 'team', 'user', 'telegram', 'work', 'cipher', 'ready', 1, 1);
    INSERT INTO im_pairing_request (id, connId, senderId, senderName, chatKey, status, requestedAt, createdAt, updatedAt)
      VALUES ('pair', 'conn', 'sender', 'Sender', 'chat', 'pending', 1, 1, 1);
  `);
  if (withImessageChildren)
    sqlite.exec(`
      INSERT INTO im_seen_inbound (connId, messageId, createdAt) VALUES ('conn', 'message', 1);
      INSERT INTO im_turn_origin (stepId, connId, chatKey, senderId, threadId, createdAt)
        VALUES ('step', 'conn', 'chat', 'sender', 'thread', 1);
    `);
}

function expectImGraphIntact(sqlite: Database.Database, withImessageChildren: boolean) {
  expect(sqlite.prepare('SELECT id, platform, status FROM im_connection').all()).toEqual([
    { id: 'conn', platform: 'telegram', status: 'ready' },
  ]);
  expect(sqlite.prepare('SELECT id, status FROM im_pairing_request').all()).toEqual([
    { id: 'pair', status: 'pending' },
  ]);
  if (withImessageChildren) {
    expect(sqlite.prepare('SELECT messageId FROM im_seen_inbound').all()).toEqual([
      { messageId: 'message' },
    ]);
    expect(sqlite.prepare('SELECT stepId FROM im_turn_origin').all()).toEqual([{ stepId: 'step' }]);
  }
  expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}

test('a real DB with pairing-request rows survives the im_connection rebuilds', () => {
  const directory = makeTestTempDir('cairn-im-connection-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    sqlite.pragma('foreign_keys = ON');
    migrateUpTo(sqlite, directory, BEFORE_REBUILD ?? '');
    seedImGraph(sqlite, false);
    sqlite.exec(`
      INSERT INTO project (id, name, teamId) VALUES ('project', 'Project', 'team');
      INSERT INTO todo (id, teamId, projectId, title, phaseAt, seqNum)
        VALUES ('todo', 'team', 'project', 'Todo', 1, 1);
      INSERT INTO tag (id, projectId, name) VALUES ('tag', 'project', 'Tag');
      INSERT INTO todo_tag (todoId, tagId) VALUES ('todo', 'tag');
    `);
    migrateAll(sqlite);
    expectImGraphIntact(sqlite, false);
    const names = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(names).not.toContain('tag');
    expect(names).not.toContain('todo_tag');
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the iMessage rebuild keeps every table that references im_connection', () => {
  const directory = makeTestTempDir('cairn-im-connection-migration-236-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    sqlite.pragma('foreign_keys = ON');
    migrateUpTo(sqlite, directory, BEFORE_IMESSAGE ?? '');
    seedImGraph(sqlite, true);
    migrateAll(sqlite);
    expectImGraphIntact(sqlite, true);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the only migrations that drop a table other tables still reference', () => {
  const created = new Map<string, number>();
  const referenced = new Map<string, number>();
  const drops: string[] = [];
  journal.entries.forEach((entry, index) => {
    const source = readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8');
    for (const match of source.matchAll(/REFERENCES `(\w+)`/g))
      if (!referenced.has(match[1] ?? '')) referenced.set(match[1] ?? '', index);
    for (const match of source.matchAll(/DROP TABLE `(\w+)`/g)) {
      const table = match[1] ?? '';
      if (table.startsWith('__new_')) continue;
      const createdAt = created.get(table);
      const referencedAt = referenced.get(table);
      if (
        createdAt === undefined ||
        createdAt >= index ||
        referencedAt === undefined ||
        referencedAt >= index
      )
        continue;
      drops.push(`${entry.tag} drops ${table}`);
    }
    for (const match of source.matchAll(/CREATE TABLE `(\w+)`/g))
      if (!created.has(match[1] ?? '')) created.set(match[1] ?? '', index);
  });
  expect(drops).toEqual([
    '0195_short_ma_gnuci drops im_connection',
    '0202_retire_tag_tables drops tag',
    '0236_chubby_boom_boom drops im_connection',
  ]);
});
