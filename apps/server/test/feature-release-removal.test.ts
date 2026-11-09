import { join } from 'node:path';
import { DB_TABLES, INTERNAL_ONLY_TABLES, WEB_REST_ENDPOINTS } from '@cairn/shared';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import { user } from '../src/db/schema.js';
import { bootServer, req, type TestServer } from './helpers.js';
import { migrateUpTo } from './migrate-helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.dispose();
});

test.each(['fresh', 'upgrade', 'latest-main'] as const)(
  '%s database has no feature release state',
  (mode) => {
    const directory = makeTestTempDir('feature-release-removal-');
    const sqlite = new Database(join(directory, 'db.sqlite'));
    sqlite.pragma('foreign_keys = ON');
    try {
      if (mode !== 'fresh') {
        migrateUpTo(
          sqlite,
          directory,
          mode === 'upgrade' ? '0131_project_group' : '0133_deploy_lease',
        );
        sqlite.exec(
          "INSERT INTO user (id, displayName) VALUES ('owner', 'Owner'), ('member', 'Member')",
        );
        sqlite.exec(`INSERT INTO feature_flag (id, key, userId, enabled, updatedAt) VALUES
        ('global-on', 'released', NULL, 1, 1),
        ('global-off', 'disabled', NULL, 0, 2),
        ('owner-off', 'private', 'owner', 0, 3),
        ('member-on', 'private', 'member', 1, 4)`);
      }
      const usersBefore =
        mode !== 'fresh' ? sqlite.prepare('SELECT * FROM user ORDER BY rowid').all() : [];
      const db = drizzle(sqlite);
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(
        sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'feature_flag%'").all(),
      ).toEqual([]);
      expect(sqlite.prepare('SELECT * FROM user ORDER BY rowid').all()).toEqual(usersBefore);
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally {
      sqlite.close();
    }
  },
);

test.each([
  ['owner', 'GET', '/api/flags'],
  ['owner', 'POST', '/api/flags/beta/release'],
  ['member', 'GET', '/api/flags'],
  ['member', 'POST', '/api/flags/beta/release'],
] as const)('%s receives 404 for %s %s', async (identity, method, path) => {
  const server = bootServer();
  servers.push(server);
  if (identity === 'member') {
    server.db.insert(user).values({ id: 'first-user', displayName: 'First' }).run();
    server.db.run(sql`UPDATE user SET rowid = 0 WHERE id = 'first-user'`);
  }
  const response = await req(server.app, method, path);
  expect(response.status).toBe(404);
});

test('registries no longer advertise feature releases', () => {
  expect(DB_TABLES).not.toContain('feature_flag');
  expect(INTERNAL_ONLY_TABLES).not.toContain('feature_flag');
  expect(WEB_REST_ENDPOINTS.filter((endpoint) => endpoint.path.startsWith('/api/flags'))).toEqual(
    [],
  );
});
