import { rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

test('0249 backfills only valid legacy red-main keys and leaves pause history intact', () => {
  const directory = makeTestTempDir('cairn-autonomy-condition-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  const sha = 'a'.repeat(40);
  try {
    migrateUpTo(sqlite, directory, '0248_no_machine_reason_marks');
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)");
    const insert = sqlite.prepare(`INSERT INTO autonomy_pause
      (id, teamId, source, reason, markers, openedAt, requestKey, resolvedAt, resolvedBy)
      VALUES (?, 'team', ?, 'original reason', '[{"repo":"octo/alpha","number":7}]', 2, ?, ?, ?)`);
    insert.run('red', 'main-red', `main-red:octo/alpha:${sha}`, null, null);
    insert.run('bad-key', 'main-red', `main-red:octo/beta:${'x'.repeat(40)}`, null, null);
    insert.run('manual', 'settings', `main-red:octo/other:${sha}`, null, null);
    insert.run('done', 'main-red', `main-red:octo/beta:${sha}`, 3, 'owner');
    migrateAll(sqlite);
    migrateAll(sqlite);
    const rows = sqlite.prepare('SELECT * FROM autonomy_pause ORDER BY id').all();
    const waitsFor = (repo: string) => JSON.stringify({ kind: 'main-green', repo, failedSha: sha });
    const unchanged = {
      reason: 'original reason',
      markers: '[{"repo":"octo/alpha","number":7}]',
      openedAt: 2,
      resolvedReason: null,
    };
    expect(rows).toEqual([
      expect.objectContaining({ ...unchanged, id: 'bad-key', waitsFor: null, resolvedAt: null }),
      expect.objectContaining({
        ...unchanged,
        id: 'done',
        waitsFor: waitsFor('octo/beta'),
        resolvedAt: 3,
        resolvedBy: 'owner',
      }),
      expect.objectContaining({ ...unchanged, id: 'manual', waitsFor: null, resolvedAt: null }),
      expect.objectContaining({
        ...unchanged,
        id: 'red',
        waitsFor: waitsFor('octo/alpha'),
        resolvedAt: null,
      }),
    ]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
