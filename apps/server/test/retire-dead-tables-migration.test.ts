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

const dropIndex = journal.entries.findIndex((entry) => entry.tag.endsWith('_adorable_shiva'));
const PREV_TAG = journal.entries[dropIndex - 1]?.tag ?? '';

const DEAD_TABLES = [
  'harness_eval_attempts',
  'harness_profile',
  'thread_conversation',
  'thread_entry',
  'legacy_agent_backup',
  'legacy_todo_assignment_backup',
  'legacy_chief_agent_backup',
  'legacy_routing_rule_adoption_backup',
];

const DEAD_COLUMNS: [string, string[]][] = [
  ['machine', ['enabledRuntimes']],
  ['routing_rule', ['tools', 'mcpServers', 'skillsAllowlist', 'defaultSkill', 'secrets']],
  [
    'team',
    [
      'coAuthorTrailer',
      'requestInstructorReview',
      'firstPrReportPromptEnabled',
      'firstPrReportPromptDismissedAt',
      'firstPrReportPromptFirstPrAt',
      'firstPrReportPromptFirstPrNumber',
    ],
  ],
  ['coordinator_conversation', ['lastColdSlimAt', 'lastColdSlimStepId']],
];

function tableNames(sqlite: Database.Database): string[] {
  return sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => (row as { name: string }).name);
}

function columnNames(sqlite: Database.Database, table: string): string[] {
  return sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => (row as { name: string }).name);
}

function expectDeadSurfaceGone(sqlite: Database.Database) {
  const names = tableNames(sqlite);
  for (const table of DEAD_TABLES) expect(names).not.toContain(table);
  for (const [table, columns] of DEAD_COLUMNS) {
    const present = columnNames(sqlite, table);
    for (const column of columns) expect(present).not.toContain(column);
  }
}

function seed(sqlite: Database.Database, directory: string) {
  migrateUpTo(sqlite, directory, PREV_TAG);
  sqlite.exec(`
    INSERT INTO user (id, displayName) VALUES ('user', 'Owner');
    INSERT INTO team (id, name, createdAt, coAuthorTrailer, firstPrReportPromptEnabled, firstPrReportPromptFirstPrNumber)
      VALUES ('team', 'Team', 1, 0, 1, 42);
    INSERT INTO machine (id, teamId, name, online, enabledRuntimes, maxConcurrent)
      VALUES ('machine', 'team', 'box', 1, '["pi","claude-code"]', 4);
    INSERT INTO routing_rule (id, teamId, \`use\`, provider, modelId, tools, secrets, requiredCapabilities, createdAt, updatedAt)
      VALUES ('route', 'team', 'coordinator', 'openai-codex', 'gpt-6.1-sol', '["exec"]', '["TOKEN"]', '["git"]', 1, 1);
    INSERT INTO coordinator_conversation (threadId, conversationId, lastColdSlimAt, lastColdSlimStepId, piVersion, updatedAt)
      VALUES ('thread', 'conversation', 7, 'step', '1', 1);
    INSERT INTO harness_profile (id, teamId, createdAt, updatedAt)
      VALUES ('profile', 'team', 1, 1);
    INSERT INTO harness_eval_attempts (id, repo, pr, patchDigest, workerId, state, deadlineAt, createdAt)
      VALUES ('attempt', 'repo', 1, 'digest', 'worker', 'done', 1, 1);
    INSERT INTO thread_conversation (threadId, storeId, conversationId, updatedAt)
      VALUES ('thread', 'store', 'conversation', 1);
    INSERT INTO thread_entry (messageId, threadId, conversationId, entryId)
      VALUES ('message', 'thread', 'conversation', 'entry');
    INSERT INTO legacy_agent_backup DEFAULT VALUES;
  `);
}

test('upgrade drops dead tables and columns and keeps live rows', () => {
  const directory = makeTestTempDir('cairn-retire-dead-tables-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    sqlite.pragma('foreign_keys = ON');
    seed(sqlite, directory);
    migrateAll(sqlite);
    expectDeadSurfaceGone(sqlite);
    expect(sqlite.prepare('SELECT id, plan FROM team').all()).toEqual([
      { id: 'team', plan: 'free' },
    ]);
    expect(sqlite.prepare('SELECT id, online FROM machine').all()).toEqual([
      { id: 'machine', online: 1 },
    ]);
    expect(
      sqlite.prepare('SELECT id, `use`, requiredCapabilities FROM routing_rule').all(),
    ).toEqual([{ id: 'route', use: 'coordinator', requiredCapabilities: '["git"]' }]);
    expect(
      sqlite.prepare('SELECT threadId, conversationId FROM coordinator_conversation').all(),
    ).toEqual([{ threadId: 'thread', conversationId: 'conversation' }]);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a failed drop leaves the batch aborted', () => {
  const directory = makeTestTempDir('cairn-retire-dead-tables-abort-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    sqlite.pragma('foreign_keys = ON');
    seed(sqlite, directory);
    sqlite.exec('DROP TABLE harness_profile');
    expect(() => migrateAll(sqlite)).toThrow();
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fresh migration builds a database without the dead surface', () => {
  const directory = makeTestTempDir('cairn-retire-dead-tables-fresh-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateAll(sqlite);
    expectDeadSurfaceGone(sqlite);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
