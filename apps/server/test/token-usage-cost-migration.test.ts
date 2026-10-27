import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, test } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { backfillTokenUsageCost } from '../src/services/token-usage-cost.js';

test('upgrading from 0057 preserves ambiguous legacy zeros instead of guessing their provenance', () => {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const cut = journal.entries.findIndex((entry) => entry.tag === '0058_token_usage_cost_nullable');
  expect(cut).toBeGreaterThan(0);
  expect(journal.entries[cut - 1]?.tag).toBe('0057_github_connection_refresh');
  const prior = mkdtempSync(join(tmpdir(), 'cairn-1847-migrations-'));
  const sqlite = new Database(':memory:');
  try {
    mkdirSync(join(prior, 'meta'));
    for (const entry of journal.entries.slice(0, cut)) {
      cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
    }
    writeFileSync(
      join(prior, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
    );
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: prior });
    expect(sqlite.prepare('PRAGMA table_info(token_usage)').all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'costTotal', notnull: 1, dflt_value: '0' }),
      ]),
    );
    const { team, user } = seed(db);
    db.insert(schema.project)
      .values({ id: 'project-old-cost', teamId: team.id, name: 'Legacy' })
      .run();
    db.insert(schema.todo)
      .values({
        id: 'todo-old-cost',
        teamId: team.id,
        projectId: 'project-old-cost',
        title: 'Legacy',
        phaseAt: 1,
        seqNum: 1,
      })
      .run();
    db.insert(schema.build)
      .values({
        id: 'build-old-cost',
        todoId: 'todo-old-cost',
        withPlan: false,
        triggerSource: 'user',
        createdAt: 1,
      })
      .run();
    db.insert(schema.provider)
      .values({
        id: 'provider-old-cost',
        teamId: team.id,
        kind: 'custom',
        providerId: 'old-gw',
        label: 'Old',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        authHeader: true,
        compat: { supportsDeveloperRole: false },
        models: [
          {
            id: 'priced',
            name: 'Priced',
            cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
          },
        ],
        createdBy: user.id,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    sqlite
      .prepare('INSERT INTO token_usage (buildId, model, input, output) VALUES (?, ?, ?, ?)')
      .run('build-old-cost', 'old-gw/priced', 1000, 2000);
    sqlite
      .prepare('INSERT INTO token_usage (buildId, model, input, output) VALUES (?, ?, ?, ?)')
      .run('build-old-cost', 'old-gw/unknown', 1000, 2000);
    const before = db.select().from(schema.tokenUsage).all();
    expect(before).toHaveLength(2);
    for (const row of before)
      expect(row).toMatchObject({
        costInput: 0,
        costOutput: 0,
        costCacheRead: 0,
        costCacheWrite: 0,
        costTotal: 0,
      });
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(sqlite.prepare('PRAGMA table_info(token_usage)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'costTotal', notnull: 0 })]),
    );
    backfillTokenUsageCost(db);
    backfillTokenUsageCost(db);
    expect(db.select().from(schema.tokenUsage).all()).toEqual(before);
  } finally {
    sqlite.close();
    rmSync(prior, { recursive: true, force: true });
  }
});
