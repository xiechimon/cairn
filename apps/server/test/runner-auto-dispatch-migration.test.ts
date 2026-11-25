import { rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

test('the runner auto-dispatch migration keeps every machine and drops the manual-only and concurrency settings', () => {
  const directory = makeTestTempDir('cairn-runner-auto-dispatch-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, '0254_machine_failover_overflow');
    sqlite.pragma('foreign_keys = OFF');
    const insert = sqlite.prepare(
      "INSERT INTO machine (id, teamId, name, online, autoDispatch, maxConcurrency) VALUES (?, 'team', ?, 1, ?, ?)",
    );
    insert.run('macbook', 'MacBook Pro', 0, null);
    insert.run('mini', 'Mac mini', 1, 2);
    migrateAll(sqlite);
    const columns = (sqlite.prepare('PRAGMA table_info(machine)').all() as { name: string }[]).map(
      (column) => column.name,
    );
    expect(columns).not.toContain('autoDispatch');
    expect(columns).not.toContain('maxConcurrency');
    expect(sqlite.prepare('SELECT id, name FROM machine ORDER BY id').all()).toEqual([
      { id: 'macbook', name: 'MacBook Pro' },
      { id: 'mini', name: 'Mac mini' },
    ]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
