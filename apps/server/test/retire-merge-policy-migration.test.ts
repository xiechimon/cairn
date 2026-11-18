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

const dropIndex = journal.entries.findIndex((entry) => entry.tag.endsWith('_retire_merge_policy'));
const DROP_TAG = journal.entries[dropIndex]?.tag ?? '';
const PREV_TAG = journal.entries[dropIndex - 1]?.tag ?? '';

test('upgrade migration drops team.namedPrompts and gate_state.policy while keeping rows', () => {
  expect(DROP_TAG.endsWith('_retire_merge_policy')).toBe(true);
  const directory = makeTestTempDir('cairn-retire-merge-policy-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, PREV_TAG);
    sqlite.exec(
      "INSERT INTO team (id, name, createdAt, namedPrompts) VALUES ('retained', 'Retained', 1, '{\"review\":\"be strict\"}')",
    );
    sqlite.exec("INSERT INTO project (id, teamId, name) VALUES ('project', 'retained', 'Project')");
    sqlite.exec(
      "INSERT INTO todo (id, teamId, projectId, title, phase, phaseAt, seqNum) VALUES ('task', 'retained', 'project', 'Task', 'review', 42, 1)",
    );
    sqlite.exec(
      "INSERT INTO build (id, todoId, withPlan, triggerSource, createdAt) VALUES ('build', 'task', 0, 'user', 20)",
    );
    sqlite.exec(
      "INSERT INTO gate_state (buildId, ready, policy, blockers, evaluatedAt) VALUES ('build', 0, '{\"mergePolicy\":\"human\"}', '[]', 30)",
    );
    migrateAll(sqlite);
    expect(sqlite.prepare('SELECT id, name FROM team').all()).toEqual([
      { id: 'retained', name: 'Retained' },
    ]);
    expect(sqlite.prepare('SELECT buildId, ready FROM gate_state').all()).toEqual([
      { buildId: 'build', ready: 0 },
    ]);
    const teamColumns = sqlite.prepare('PRAGMA table_info(team)').all() as { name: string }[];
    expect(teamColumns.some((column) => column.name === 'namedPrompts')).toBe(false);
    const gateColumns = sqlite.prepare('PRAGMA table_info(gate_state)').all() as { name: string }[];
    expect(gateColumns.some((column) => column.name === 'policy')).toBe(false);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fresh migration builds a database without the retired columns', () => {
  const directory = makeTestTempDir('cairn-retire-merge-policy-fresh-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateAll(sqlite);
    const teamColumns = sqlite.prepare('PRAGMA table_info(team)').all() as { name: string }[];
    expect(teamColumns.some((column) => column.name === 'namedPrompts')).toBe(false);
    const gateColumns = sqlite.prepare('PRAGMA table_info(gate_state)').all() as { name: string }[];
    expect(gateColumns.some((column) => column.name === 'policy')).toBe(false);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
