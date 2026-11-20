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

const dropIndex = journal.entries.findIndex((entry) => entry.tag.endsWith('_drop_action_tier'));
const PREV_TAG = journal.entries[dropIndex - 1]?.tag ?? '';

test('upgrade drops team.actionTier and strips the removed autonomy keys, keeping the rest', () => {
  expect(dropIndex).toBeGreaterThan(0);
  const directory = makeTestTempDir('cairn-drop-autonomy-knobs-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, PREV_TAG);
    sqlite.exec(
      "INSERT INTO team (id, name, createdAt, actionTier) VALUES ('team', 'Team', 1, 'guarded')",
    );
    sqlite.prepare('INSERT INTO project (id, teamId, name, autonomy) VALUES (?, ?, ?, ?)').run(
      'tuned',
      'team',
      'Tuned',
      JSON.stringify({
        enabled: false,
        quietMinutes: 0,
        cooldownMinutes: 0,
        dailyBudgetUsd: 0,
        actionTier: 'guarded',
        planAutoApproveEnabled: false,
      }),
    );
    sqlite.exec("INSERT INTO project (id, teamId, name) VALUES ('plain', 'team', 'Plain')");
    migrateAll(sqlite);
    expect(sqlite.prepare("SELECT name FROM pragma_table_info('team')").all()).not.toContainEqual({
      name: 'actionTier',
    });
    const rows = sqlite.prepare('SELECT id, autonomy FROM project ORDER BY id').all() as {
      id: string;
      autonomy: string | null;
    }[];
    expect(rows.map((row) => [row.id, row.autonomy && JSON.parse(row.autonomy)])).toEqual([
      ['plain', null],
      ['tuned', { enabled: false, planAutoApproveEnabled: false }],
    ]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
