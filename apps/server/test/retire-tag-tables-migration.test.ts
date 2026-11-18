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

const dropIndex = journal.entries.findIndex((entry) => entry.tag.endsWith('_retire_tag_tables'));
const DROP_TAG = journal.entries[dropIndex]?.tag ?? '';
const PREV_TAG = journal.entries[dropIndex - 1]?.tag ?? '';

test('upgrade migration backfills correction and drops tag tables while keeping labels', () => {
  expect(DROP_TAG.endsWith('_retire_tag_tables')).toBe(true);
  const directory = makeTestTempDir('cairn-retire-tag-tables-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    sqlite.pragma('foreign_keys = ON');
    migrateUpTo(sqlite, directory, PREV_TAG);
    sqlite.exec(`
      INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1);
      INSERT INTO project (id, teamId, name) VALUES ('project', 'team', 'Project');
      INSERT INTO todo (id, teamId, projectId, title, spec, phaseAt, seqNum, correctionRequired)
        VALUES ('flagged', 'team', 'project', 'Flagged', '', 1, 1, 0),
               ('already', 'team', 'project', 'Already', '', 1, 2, 1),
               ('ordinary', 'team', 'project', 'Ordinary', '', 1, 3, 0);
      INSERT INTO tag (id, projectId, name, color)
        VALUES ('correction-tag', 'project', 'CoRrEcTiOn', '#123456'),
               ('bug-tag', 'project', 'bug', '#abcdef');
      INSERT INTO todo_tag (todoId, tagId)
        VALUES ('flagged', 'correction-tag'), ('ordinary', 'bug-tag');
      INSERT INTO github_label (id, projectId, name, color)
        VALUES ('label', 'project', 'enhancement', '#112233');
      INSERT INTO todo_github_label (todoId, labelId) VALUES ('flagged', 'label');
    `);
    migrateAll(sqlite);
    expect(
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tag', 'todo_tag')",
        )
        .all(),
    ).toEqual([]);
    expect(sqlite.prepare('SELECT id, correctionRequired FROM todo ORDER BY id').all()).toEqual([
      { id: 'already', correctionRequired: 1 },
      { id: 'flagged', correctionRequired: 1 },
      { id: 'ordinary', correctionRequired: 0 },
    ]);
    expect(sqlite.prepare('SELECT id, name FROM github_label').all()).toEqual([
      { id: 'label', name: 'enhancement' },
    ]);
    expect(sqlite.prepare('SELECT todoId, labelId FROM todo_github_label').all()).toEqual([
      { todoId: 'flagged', labelId: 'label' },
    ]);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fresh migration builds a database without tag tables', () => {
  const directory = makeTestTempDir('cairn-retire-tag-tables-fresh-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateAll(sqlite);
    expect(
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tag', 'todo_tag')",
        )
        .all(),
    ).toEqual([]);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
