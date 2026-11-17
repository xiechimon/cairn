import { rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

test('upgrading drops step git keys whose step is not running and keeps every other key', () => {
  const directory = makeTestTempDir('cairn-step-git-key-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, '0179_github_connection_device_grant');
    sqlite.prepare("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)").run();
    const insertStep = sqlite.prepare(
      'INSERT INTO step (id, buildId, kind, status, createdAt) VALUES (?, ?, ?, ?, ?)',
    );
    insertStep.run('running', 'build', 'session', 'claimed', 1);
    insertStep.run('finished', 'build', 'session', 'done', 1);
    insertStep.run('released', 'build', 'session', 'pending', 1);
    const insertKey = sqlite.prepare(
      `INSERT INTO api_key (id, teamId, name, gitAccess, mcpAccess, toolGrants, keyHash, masked, createdAt)
       VALUES (?, 'team', ?, 1, 0, '{"read":[],"write":[]}', ?, 'cairn_x…', 1)`,
    );
    insertKey.run('k-running', 'git-step-running', 'h1');
    insertKey.run('k-finished', 'git-step-finished', 'h2');
    insertKey.run('k-released', 'git-step-released', 'h3');
    insertKey.run('k-gone', 'git-step-deleted-long-ago', 'h4');
    insertKey.run('k-user', 'LAPTOP', 'h5');
    insertKey.run('k-unnamed', null, 'h6');
    migrateAll(sqlite);
    const ids = () =>
      sqlite
        .prepare('SELECT id FROM api_key ORDER BY id')
        .all()
        .map((row) => (row as { id: string }).id);
    expect(ids()).toEqual(['k-running', 'k-unnamed', 'k-user']);
    sqlite.prepare("UPDATE step SET status = 'claimed' WHERE id = 'released'").run();
    insertKey.run('k-released', 'git-step-released', 'h3');
    sqlite.prepare("UPDATE step SET status = 'failed' WHERE id = 'running'").run();
    expect(ids()).toEqual(['k-released', 'k-unnamed', 'k-user']);
    sqlite.prepare("DELETE FROM step WHERE id = 'released'").run();
    expect(ids()).toEqual(['k-unnamed', 'k-user']);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
