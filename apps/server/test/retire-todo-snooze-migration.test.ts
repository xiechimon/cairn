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

const dropIndex = journal.entries.findIndex((entry) => entry.tag.endsWith('_retire_todo_snooze'));
const DROP_TAG = journal.entries[dropIndex]?.tag ?? '';
const PREV_TAG = journal.entries[dropIndex - 1]?.tag ?? '';

test('upgrade migration drops snoozedUntil and snoozeMode and keeps existing todo rows', () => {
  expect(DROP_TAG.endsWith('_retire_todo_snooze')).toBe(true);
  const directory = makeTestTempDir('cairn-retire-snooze-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, PREV_TAG);
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('retained', 'Retained', 1)");
    sqlite.exec("INSERT INTO project (id, teamId, name) VALUES ('project', 'retained', 'Project')");
    sqlite.exec(
      "INSERT INTO todo (id, teamId, projectId, title, phase, phaseAt, seqNum, snoozedUntil, snoozeMode) VALUES ('task', 'retained', 'project', 'Task', 'done', 42, 1, 99, 'until')",
    );
    sqlite.exec(
      "INSERT INTO todo (id, teamId, projectId, title, phase, phaseAt, seqNum, snoozedUntil, snoozeMode) VALUES ('awake', 'retained', 'project', 'Awake', 'todo', 43, 2, NULL, NULL)",
    );
    migrateAll(sqlite);
    expect(sqlite.prepare('SELECT id, phase, phaseAt FROM todo ORDER BY seqNum').all()).toEqual([
      { id: 'task', phase: 'done', phaseAt: 42 },
      { id: 'awake', phase: 'todo', phaseAt: 43 },
    ]);
    const columns = sqlite
      .prepare(
        "SELECT name FROM pragma_table_info('todo') WHERE name IN ('snoozedUntil', 'snoozeMode')",
      )
      .all();
    expect(columns).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fresh migration builds a todo table without snooze columns', () => {
  const directory = makeTestTempDir('cairn-retire-snooze-fresh-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateAll(sqlite);
    const columns = sqlite
      .prepare("SELECT name FROM pragma_table_info('todo') ORDER BY name")
      .all() as { name: string }[];
    expect(columns.map((column) => column.name)).not.toContain('snoozedUntil');
    expect(columns.map((column) => column.name)).not.toContain('snoozeMode');
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
