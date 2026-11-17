import Database from 'better-sqlite3';
import { afterEach, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) releaseTestTempDir(directory);
});

test('past automatic retries become retry builds while person and Coordinator restarts stay user', () => {
  const directory = makeTestTempDir('build-retry-trigger-');
  directories.push(directory);
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON');
    migrateUpTo(sqlite, directory, '0180_step_git_key_lifetime');
    sqlite.exec(`
      INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1);
      INSERT INTO project (id, teamId, name) VALUES ('project', 'team', 'Project');
      INSERT INTO todo (id, teamId, projectId, title, phaseAt, seqNum)
        VALUES ('auto', 'team', 'project', 'Auto', 1, 1),
               ('person', 'team', 'project', 'Person', 1, 2),
               ('coordinator', 'team', 'project', 'Coordinator', 1, 3),
               ('late', 'team', 'project', 'Late', 1, 4);
      INSERT INTO build (id, todoId, withPlan, prevPhase, triggerSource, createdAt)
        VALUES ('auto-failed', 'auto', 0, 'todo', 'user', 1000),
               ('auto-retry', 'auto', 0, 'failed', 'user', 2003),
               ('person-failed', 'person', 0, 'todo', 'user', 1000),
               ('person-restart', 'person', 0, 'failed', 'user', 2003),
               ('coordinator-failed', 'coordinator', 0, 'todo', 'user', 1000),
               ('coordinator-restart', 'coordinator', 0, 'failed', 'user', 2003),
               ('late-failed', 'late', 0, 'todo', 'user', 1000),
               ('late-start', 'late', 0, 'failed', 'user', 60000);
      INSERT INTO build_feedback (id, buildId, kind, side, feedback, actor, createdAt)
        VALUES ('f1', 'auto-failed', 'restart', 'build', '', 'cairn', 2000),
               ('f2', 'person-failed', 'restart', 'build', 'Use the fixture', 'Owner', 2000),
               ('f3', 'coordinator-failed', 'restart', 'build', 'Try again', 'Coordinator', 2000),
               ('f4', 'late-failed', 'restart', 'build', '', 'cairn', 2000);
      INSERT INTO step (id, buildId, kind, status, byPerson, createdAt)
        VALUES ('s1', 'auto-retry', 'session', 'success', 0, 2003),
               ('s2', 'person-restart', 'session', 'success', 1, 2003),
               ('s3', 'coordinator-restart', 'session', 'success', 0, 2003),
               ('s4', 'late-start', 'session', 'success', 0, 60000);
    `);
    migrateAll(sqlite);
    expect(sqlite.prepare('SELECT id, triggerSource FROM build ORDER BY id').all()).toEqual([
      { id: 'auto-failed', triggerSource: 'user' },
      { id: 'auto-retry', triggerSource: 'retry' },
      { id: 'coordinator-failed', triggerSource: 'user' },
      { id: 'coordinator-restart', triggerSource: 'user' },
      { id: 'late-failed', triggerSource: 'user' },
      { id: 'late-start', triggerSource: 'user' },
      { id: 'person-failed', triggerSource: 'user' },
      { id: 'person-restart', triggerSource: 'user' },
    ]);
  } finally {
    sqlite.close();
  }
});
