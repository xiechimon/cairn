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

const dropIndex = journal.entries.findIndex((entry) => entry.tag.endsWith('_retire_branch_sync'));
const DROP_TAG = journal.entries[dropIndex]?.tag ?? '';
const PREV_TAG = journal.entries[dropIndex - 1]?.tag ?? '';

test('upgrade migration drops branch_sync and keeps existing build rows', () => {
  expect(DROP_TAG.endsWith('_retire_branch_sync')).toBe(true);
  const directory = makeTestTempDir('cairn-retire-branch-sync-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, PREV_TAG);
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('retained', 'Retained', 1)");
    sqlite.exec("INSERT INTO project (id, teamId, name) VALUES ('project', 'retained', 'Project')");
    sqlite.exec("INSERT INTO machine (id, teamId, name) VALUES ('box', 'retained', 'Box')");
    sqlite.exec(
      "INSERT INTO todo (id, teamId, projectId, title, phase, phaseAt, seqNum) VALUES ('task', 'retained', 'project', 'Task', 'building', 42, 1)",
    );
    sqlite.exec(
      "INSERT INTO build (id, todoId, withPlan, triggerSource, createdAt) VALUES ('build', 'task', 0, 'user', 20)",
    );
    sqlite.exec(
      "INSERT INTO branch_sync (id, buildId, machineId, teamId, directory, ref, `commit`, status, createdAt) VALUES ('sync', 'build', 'box', 'retained', '/repo', 'main', 'abc', 'pending', 1)",
    );
    migrateAll(sqlite);
    expect(sqlite.prepare('SELECT id, todoId, createdAt FROM build').all()).toEqual([
      { id: 'build', todoId: 'task', createdAt: 20 },
    ]);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'branch_sync'")
      .all();
    expect(tables).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fresh migration builds a database without a branch_sync table', () => {
  const directory = makeTestTempDir('cairn-retire-branch-sync-fresh-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateAll(sqlite);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'branch_sync'")
      .all();
    expect(tables).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
