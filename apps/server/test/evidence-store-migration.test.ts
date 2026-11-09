import { rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

test('migration initializes only existing cairn projects and never reassigns modes', () => {
  const directory = makeTestTempDir('cairn-evidence-store-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, '0131_project_group');
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)");
    const insert = sqlite.prepare(
      'INSERT INTO project (id, name, teamId, repoKind, githubRepo) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run('cairn', 'Cairn', 'team', 'github', 'xiechimon/cairn');
    insert.run('cairn-mixed', 'Cairn mixed case', 'team', 'github', 'Xiechimon/Cairn');
    insert.run('other', 'Other', 'team', 'github', 'example/app');
    insert.run('fork', 'Fork', 'team', 'github', 'fork/cairn');
    insert.run('plain', 'Cairn', 'team', null, null);
    sqlite.exec(
      "INSERT INTO todo (id, teamId, projectId, title, phaseAt, seqNum) VALUES ('todo', 'team', 'cairn', 'Task', 1, 1)",
    );
    sqlite.exec(
      "INSERT INTO build (id, todoId, withPlan, triggerSource, createdAt) VALUES ('old', 'todo', 0, 'user', 1)",
    );
    migrateAll(sqlite);
    insert.run('new-cairn', 'New Cairn', 'team', 'github', 'xiechimon/cairn');
    expect(sqlite.prepare('SELECT id, evidenceStore FROM project ORDER BY id').all()).toEqual([
      { id: 'cairn', evidenceStore: 'repository' },
      { id: 'cairn-mixed', evidenceStore: 'repository' },
      { id: 'fork', evidenceStore: 'attachments' },
      { id: 'new-cairn', evidenceStore: 'attachments' },
      { id: 'other', evidenceStore: 'attachments' },
      { id: 'plain', evidenceStore: 'attachments' },
    ]);
    expect(sqlite.prepare('SELECT evidenceStore FROM build').get()).toEqual({
      evidenceStore: null,
    });
    sqlite.exec("UPDATE project SET evidenceStore = 'attachments' WHERE id = 'cairn'");
    migrateAll(sqlite);
    expect(sqlite.prepare("SELECT evidenceStore FROM project WHERE id = 'cairn'").get()).toEqual({
      evidenceStore: 'attachments',
    });
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('evidence migration upgrades the latest main database without replacing its schema', () => {
  const directory = makeTestTempDir('cairn-evidence-main-upgrade-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, '0133_deploy_lease');
    migrateAll(sqlite);
    expect(sqlite.prepare('SELECT evidenceStore FROM project').all()).toEqual([]);
    expect(sqlite.prepare('SELECT evidenceStore FROM build').all()).toEqual([]);
    expect(sqlite.prepare('SELECT browserEnabled FROM computer').all()).toEqual([]);
    expect(
      sqlite.prepare('SELECT name FROM sqlite_master WHERE name = ?').get('deploy_lease'),
    ).toBeDefined();
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
