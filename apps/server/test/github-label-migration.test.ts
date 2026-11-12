import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../src/db/client.js';
import { runAgentLayerDataMigration } from '../src/legacy/agent-layer/data-migration.js';
import { migrateUpTo } from './migrate-helpers.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) releaseTestTempDir(directory);
});

function legacyDatabase() {
  const directory = makeTestTempDir('github-label-migration-');
  directories.push(directory);
  const path = join(directory, 'server.db');
  const sqlite = new Database(path);
  try {
    sqlite.pragma('foreign_keys = ON');
    migrateUpTo(sqlite, directory, '0119_agent_layer_backup');
    runAgentLayerDataMigration(sqlite);
    migrateUpTo(sqlite, directory, '0143_blocked_by_hold');
    sqlite.exec(`
      INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1);
      INSERT INTO project (id, teamId, name, repoKind, githubRepo)
        VALUES ('github', 'team', 'Repository', 'github', 'octo/demo'),
               ('local', 'team', 'Local', NULL, NULL);
      INSERT INTO todo (id, teamId, projectId, title, phaseAt, seqNum, sourceKind, correctionRequired)
        VALUES ('issue', 'team', 'github', 'Imported', 1, 1, 'github-issue', 0),
               ('moved', 'team', 'local', 'Moved import', 2, 2, 'github-issue', 1),
               ('self', 'team', 'local', 'Moved self issue', 3, 3, 'github-issue-self', 0),
               ('ordinary', 'team', 'local', 'Ordinary', 4, 4, NULL, 1);
      INSERT INTO tag (id, projectId, name, color, createdAt, v)
        VALUES ('first', 'github', 'bug', '#112233', 10, 2),
               ('second', 'github', 'bug', '#445566', 11, 3),
               ('unused', 'github', 'retained upstream label', '#778899', 12, 4),
               ('shared', 'local', 'correction', '#aabbcc', 13, 5),
               ('self-label', 'local', 'self label', '#ddeeff', 14, 6),
               ('local-only', 'local', 'ordinary category', '#000000', 15, 7);
      INSERT INTO todo_tag (todoId, tagId)
        VALUES ('issue', 'first'), ('issue', 'second'), ('moved', 'shared'),
               ('self', 'self-label'), ('ordinary', 'shared'), ('ordinary', 'local-only');
      INSERT INTO build (id, todoId, withPlan, triggerSource, createdAt)
        VALUES ('build', 'ordinary', 0, 'user', 20);
    `);
  } finally {
    sqlite.close();
  }
  return path;
}

function legacyState(sqlite: Database.Database) {
  return {
    tasks: sqlite.prepare('SELECT * FROM todo ORDER BY id').all(),
    builds: sqlite.prepare('SELECT * FROM build ORDER BY id').all(),
    vocabulary: sqlite.prepare('SELECT * FROM tag ORDER BY id').all(),
    links: sqlite.prepare('SELECT * FROM todo_tag ORDER BY todoId, tagId').all(),
  };
}

test('cutover preserves exact label identities and metadata, moved origins and shared ordinary categories', () => {
  const path = legacyDatabase();
  const before = new Database(path, { readonly: true });
  const original = legacyState(before);
  const selected = before.prepare("SELECT * FROM tag WHERE id != 'local-only' ORDER BY id").all();
  before.close();
  const opened = openDbWithHandle(path);
  try {
    expect(opened.db.all('SELECT * FROM github_label ORDER BY id')).toEqual(selected);
    expect(opened.db.all('SELECT * FROM todo_github_label ORDER BY todoId, labelId')).toEqual([
      { todoId: 'issue', labelId: 'first' },
      { todoId: 'issue', labelId: 'second' },
      { todoId: 'moved', labelId: 'shared' },
      { todoId: 'self', labelId: 'self-label' },
    ]);
    expect(opened.db.all('SELECT * FROM todo_tag ORDER BY todoId, tagId')).toEqual([
      { todoId: 'ordinary', tagId: 'local-only' },
      { todoId: 'ordinary', tagId: 'shared' },
    ]);
    expect(opened.db.all('SELECT * FROM todo ORDER BY id')).toEqual(original.tasks);
    expect(opened.db.all('SELECT * FROM build ORDER BY id')).toEqual(
      original.builds.map((row) => ({ ...(row as object), afterStopPhase: null })),
    );
    expect(opened.db.all('SELECT * FROM tag ORDER BY id')).toEqual(original.vocabulary);
    expect(opened.db.all('PRAGMA foreign_key_check')).toEqual([]);
  } finally {
    opened.close();
  }
  const restarted = openDbWithHandle(path);
  try {
    expect(restarted.db.all('SELECT * FROM github_label')).toHaveLength(5);
    expect(restarted.db.all('SELECT * FROM todo_github_label')).toHaveLength(4);
    expect(restarted.db.all('SELECT * FROM todo_tag')).toHaveLength(2);
    expect(restarted.db.all('PRAGMA foreign_key_check')).toEqual([]);
  } finally {
    restarted.close();
  }
});

test('a failed cutover rolls back new tables, copied data and association removal', () => {
  const path = legacyDatabase();
  const sqlite = new Database(path);
  const original = legacyState(sqlite);
  sqlite.exec(`CREATE TRIGGER reject_label_cutover BEFORE DELETE ON todo_tag
    BEGIN SELECT RAISE(ABORT, 'cutover blocked'); END`);
  sqlite.close();
  expect(() => openDbWithHandle(path)).toThrow(/DELETE FROM todo_tag/);
  const after = new Database(path, { readonly: true });
  try {
    expect(legacyState(after)).toEqual(original);
    expect(
      after
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('github_label', 'todo_github_label')",
        )
        .all(),
    ).toEqual([]);
  } finally {
    after.close();
  }
});

test.each(['project', 'label', 'task'] as const)(
  'missing %s provenance aborts instead of discarding associations',
  (missing) => {
    const path = legacyDatabase();
    const sqlite = new Database(path);
    sqlite.pragma('foreign_keys = OFF');
    sqlite.exec(
      {
        project: "UPDATE tag SET projectId = 'missing-project' WHERE id = 'self-label'",
        label: "DELETE FROM tag WHERE id = 'self-label'",
        task: "DELETE FROM todo WHERE id = 'self'",
      }[missing],
    );
    const original = legacyState(sqlite);
    sqlite.close();
    expect(() => openDbWithHandle(path)).toThrow();
    const after = new Database(path, { readonly: true });
    try {
      expect(legacyState(after)).toEqual(original);
      expect(
        after.prepare("SELECT name FROM sqlite_master WHERE name = 'github_label'").get(),
      ).toBeUndefined();
    } finally {
      after.close();
    }
  },
);
