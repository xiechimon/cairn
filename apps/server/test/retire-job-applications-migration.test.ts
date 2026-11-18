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

const dropIndex = journal.entries.findIndex((entry) =>
  entry.tag.endsWith('_retire_job_applications'),
);
const DROP_TAG = journal.entries[dropIndex]?.tag ?? '';
const PREV_TAG = journal.entries[dropIndex - 1]?.tag ?? '';

test('upgrade migration drops job_application while keeping other tables', () => {
  expect(DROP_TAG.endsWith('_retire_job_applications')).toBe(true);
  const directory = makeTestTempDir('cairn-retire-job-applications-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, PREV_TAG);
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('retained', 'Retained', 1)");
    sqlite.exec("INSERT INTO user (id, displayName) VALUES ('u1', 'Owner')");
    sqlite.exec("INSERT INTO job_application (userId, document) VALUES ('u1', '{\"fields\":{}}')");
    migrateAll(sqlite);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'job_application'")
      .all();
    expect(tables).toEqual([]);
    expect(sqlite.prepare('SELECT id, name FROM team').all()).toEqual([
      { id: 'retained', name: 'Retained' },
    ]);
    expect(sqlite.prepare('SELECT id FROM user').all()).toEqual([{ id: 'u1' }]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fresh migration builds a database without a job_application table', () => {
  const directory = makeTestTempDir('cairn-retire-job-applications-fresh-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateAll(sqlite);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'job_application'")
      .all();
    expect(tables).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
