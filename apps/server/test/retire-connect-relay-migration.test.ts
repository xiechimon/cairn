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

const dropIndex = journal.entries.findIndex((entry) => entry.tag.endsWith('_magical_kulan_gath'));
const PREV_TAG = journal.entries[dropIndex - 1]?.tag ?? '';

function columnNames(sqlite: Database.Database, table: string): string[] {
  return sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => (row as { name: string }).name);
}

function seed(sqlite: Database.Database, directory: string) {
  migrateUpTo(sqlite, directory, PREV_TAG);
  sqlite.exec(`
    INSERT INTO user (id, displayName) VALUES ('user', 'Owner');
    INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1);
    INSERT INTO paired_device (id, teamId, name, tokenHash, masked, createdAt)
      VALUES ('device', 'team', 'phone', 'hash', '…', 1);
    INSERT INTO pairing_grant (id, codeHash, relayScope, expiresAt, createdAt)
      VALUES ('grant', 'code', 'install:1', 9, 1);
    INSERT INTO browser_session (id, tokenHash, kind, deviceId, relayScope, expiresAt, createdAt)
      VALUES ('session', 'tok', 'device', 'device', 'install:1', 9, 1);
  `);
}

function expectRelayScopeGone(sqlite: Database.Database) {
  for (const table of ['browser_session', 'pairing_grant']) {
    expect(columnNames(sqlite, table)).not.toContain('relayScope');
  }
}

test('upgrade drops relayScope columns and keeps live rows', () => {
  const directory = makeTestTempDir('cairn-retire-connect-relay-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    sqlite.pragma('foreign_keys = ON');
    seed(sqlite, directory);
    migrateAll(sqlite);
    expectRelayScopeGone(sqlite);
    expect(
      sqlite.prepare('SELECT id, tokenHash, kind, deviceId FROM browser_session').all(),
    ).toEqual([{ id: 'session', tokenHash: 'tok', kind: 'device', deviceId: 'device' }]);
    expect(sqlite.prepare('SELECT id, codeHash, expiresAt FROM pairing_grant').all()).toEqual([
      { id: 'grant', codeHash: 'code', expiresAt: 9 },
    ]);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fresh migration builds a database without the relay columns', () => {
  const directory = makeTestTempDir('cairn-retire-connect-relay-fresh-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateAll(sqlite);
    expectRelayScopeGone(sqlite);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
