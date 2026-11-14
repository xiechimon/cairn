import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';

test('the migration seeds the default Runner from the session rule machine, else the only machine', () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(
      'CREATE TABLE team (id TEXT PRIMARY KEY); CREATE TABLE machine (id TEXT PRIMARY KEY, teamId TEXT); CREATE TABLE routing_rule (teamId TEXT, use TEXT, machineId TEXT);',
    );
    sqlite.exec(
      "INSERT INTO team VALUES ('ruled'), ('single'), ('several'), ('none');" +
        "INSERT INTO machine VALUES ('r1', 'ruled'), ('r2', 'ruled'), ('s1', 'single'), ('v1', 'several'), ('v2', 'several');" +
        "INSERT INTO routing_rule VALUES ('ruled', 'review', 'r1'), ('ruled', 'session', 'r2'), ('single', 'session', NULL);",
    );
    sqlite.exec(
      readFileSync(join(MIGRATIONS_FOLDER, '0164_default_runner.sql'), 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      ),
    );
    expect(sqlite.prepare('SELECT id, defaultMachineId FROM team ORDER BY id').all()).toEqual([
      { id: 'none', defaultMachineId: null },
      { id: 'ruled', defaultMachineId: 'r2' },
      { id: 'several', defaultMachineId: null },
      { id: 'single', defaultMachineId: 's1' },
    ]);
  } finally {
    sqlite.close();
  }
});
