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

const dropIndex = journal.entries.findIndex((entry) => entry.tag.endsWith('_retire_chief_report'));
const DROP_TAG = journal.entries[dropIndex]?.tag ?? '';
const PREV_TAG = journal.entries[dropIndex - 1]?.tag ?? '';

const TABLES =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('chief_report', 'retro_proposal') ORDER BY name";

function seed(sqlite: Database.Database, directory: string) {
  migrateUpTo(sqlite, directory, PREV_TAG);
  sqlite.exec(`
    INSERT INTO user (id, displayName) VALUES ('user', 'Owner');
    INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1);
    INSERT INTO project (id, teamId, name) VALUES ('project', 'team', 'Project');
    INSERT INTO todo (id, teamId, projectId, title, spec, phaseAt, seqNum)
      VALUES ('todo', 'team', 'project', 'Todo', '', 1, 1);
    INSERT INTO chief (id, userId, teamId, tz, createdAt)
      VALUES ('chief', 'user', 'team', 'Asia/Singapore', 1);
    INSERT INTO chief_thread (id, chiefId, userId, teamId, title, sessionId, sessionOpenedAt, createdAt, updatedAt)
      VALUES ('thread', 'chief', 'user', 'team', 'Coordinator', '', 1, 1, 1);
    INSERT INTO chief_message (id, threadId, role, content, createdAt)
      VALUES ('chief-report-old', 'thread', 'system', '{"kind":"chief_daily_report"}', 1);
    INSERT INTO chief_report (id, chiefId, teamId, day, threadId, status, attempts, createdAt)
      VALUES ('old-report', 'chief', 'team', '2026-11-15', 'thread', 'posted', 1, 1);
    INSERT INTO retro_proposal (id, reportId, teamId, projectId, title, what, why, safeguard, sourceKind, sourceId, sourceLabel, status, createdAt)
      VALUES ('old-retro', 'old-report', 'team', 'project', 'T', 'W', 'Y', 'S', 'intake', 'x', 'l', 'draft', 1);
  `);
}

test('upgrade migration drops chief_report and retro_proposal while keeping chat history', () => {
  expect(DROP_TAG.endsWith('_retire_chief_report')).toBe(true);
  const directory = makeTestTempDir('cairn-retire-chief-report-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    sqlite.pragma('foreign_keys = ON');
    seed(sqlite, directory);
    expect(sqlite.prepare(TABLES).all()).toEqual([
      { name: 'chief_report' },
      { name: 'retro_proposal' },
    ]);
    migrateAll(sqlite);
    expect(sqlite.prepare(TABLES).all()).toEqual([]);
    expect(sqlite.prepare('SELECT id FROM todo').all()).toEqual([{ id: 'todo' }]);
    expect(sqlite.prepare('SELECT id FROM chief_message ORDER BY id').all()).toEqual([
      { id: 'chief-report-old' },
    ]);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a failed first drop aborts the batch and leaves retro_proposal intact', () => {
  const directory = makeTestTempDir('cairn-retire-chief-report-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    sqlite.pragma('foreign_keys = ON');
    seed(sqlite, directory);
    sqlite.exec('DROP TABLE chief_report');
    expect(() => migrateAll(sqlite)).toThrow();
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'retro_proposal'")
        .all(),
    ).toEqual([{ name: 'retro_proposal' }]);
    expect(sqlite.prepare('SELECT id FROM retro_proposal').all()).toEqual([{ id: 'old-retro' }]);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fresh migration builds a database without the retired tables', () => {
  const directory = makeTestTempDir('cairn-retire-chief-report-fresh-');
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
