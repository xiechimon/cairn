import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import { migrateUpTo } from './migrate-helpers.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

test('existing active self-issue tasks are recorded open, so the first sweep never reopens a hand-closed issue', () => {
  const dir = makeTestTempDir('task-issue-sync-migration-');
  dirs.push(dir);
  const sqlite = new Database(join(dir, 'cairn.db'));
  migrateUpTo(sqlite, dir, '0125_build_stop');
  sqlite.exec(`
    INSERT INTO team (id, name, createdAt) VALUES ('t', 'T', 1);
    INSERT INTO project (id, name, teamId, repoKind, githubRepo) VALUES ('p', 'P', 't', 'github', 'octo/demo');
  `);
  const insert = sqlite.prepare(
    `INSERT INTO todo (id, teamId, projectId, title, phase, phaseAt, seqNum, sourceKind, sourceRef, archivedAt)
     VALUES (?, 't', 'p', 'x', ?, 1, ?, ?, ?, ?)`,
  );
  insert.run('active', 'building', 1, 'github-issue-self', 'github:octo/demo#1', null);
  insert.run('failed', 'failed', 2, 'github-issue-self', 'github:octo/demo#2', null);
  insert.run('cancelled', 'closed', 3, 'github-issue-self', 'github:octo/demo#3', null);
  insert.run('archived', 'todo', 4, 'github-issue-self', 'github:octo/demo#4', 5);
  insert.run('done', 'done', 5, 'github-issue-self', 'github:octo/demo#5', null);
  insert.run('pending', 'todo', 6, 'github-issue-self', null, null);
  insert.run('imported', 'todo', 7, 'github-issue', 'github:octo/demo#7', null);
  migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });
  const states = Object.fromEntries(
    (
      sqlite.prepare('SELECT id, issueState FROM todo').all() as {
        id: string;
        issueState: string | null;
      }[]
    ).map((row) => [row.id, row.issueState]),
  );
  expect(states).toEqual({
    active: 'open',
    failed: 'open',
    cancelled: null,
    archived: null,
    done: null,
    pending: null,
    imported: null,
  });
  sqlite.close();
});
