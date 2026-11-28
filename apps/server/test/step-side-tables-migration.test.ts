import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect, onTestFinished, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER, migrateDatabase, openDbWithHandle } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { listSteps } from '../src/services/builds.js';
import { acquireWorkerStepLease, heartbeatStep } from '../src/services/step-lease.js';
import { bootServer } from './helpers.js';

const groups = {
  step_quota: ['quotaBlock', 'fallback', 'ranModel'],
  step_subscription: ['claudeSubscriptionId', 'devinSubscriptionId', 'antigravitySubscriptionId'],
  step_schedule: ['scheduleId', 'scheduledBy'],
  step_memory_trace: ['memoryTrace'],
  step_skill_injection: ['skillInjection'],
  step_blocker_handoff: ['blockerHandoff'],
};

const populated = {
  claimed: {
    claudeSubscriptionId: 'test-subscription',
    skillInjection: '{ "hits": [] }',
    ranModel: '{"provider":"claude-code","modelId":"test-model"}',
    memoryTrace:
      '{"teamMemoryIds":[],"teamMemoriesOmitted":0,"projectMemoryIds":[],"projectMemoriesOmitted":0,"recalledMemoryIds":[]}',
  },
  waiting_quota: {
    quotaBlock:
      '{"kind":"quota","providerId":"test-provider","reason":"quota","firstAt":10,"lastAt":10,"attempts":1,"probeAt":11}',
    fallback: '{"model":{"provider":"test-provider","modelId":"test-model"},"tried":[]}',
    devinSubscriptionId: 'test-history',
  },
  done: { scheduleId: 'test-schedule', scheduledBy: 'test-user' },
  failed: { antigravitySubscriptionId: 'test-account', blockerHandoff: '{"blockers":[]}' },
  stopped: {},
  pending: {},
};

type Row = Record<string, unknown>;

function stepRows(sqlite: Database.Database): Row[] {
  return sqlite.prepare('SELECT rowid, * FROM step ORDER BY rowid').all() as Row[];
}

function stepSchemaObjects(sqlite: Database.Database): Row[] {
  return sqlite
    .prepare(
      "SELECT type, name, sql FROM sqlite_schema WHERE tbl_name = 'step' AND type != 'table' ORDER BY name",
    )
    .all() as Row[];
}

function migrationHistory(sqlite: Database.Database): Row[] {
  return sqlite.prepare('SELECT rowid, * FROM __drizzle_migrations ORDER BY rowid').all() as Row[];
}

test('startup moves all six groups on a populated online backup without changing steps or lease identity', async () => {
  const dir = makeTestTempDir('step-side-tables-');
  onTestFinished(() => {
    releaseTestTempDir(dir);
  });
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
  ) as {
    entries: { tag: string }[];
  };
  const split = journal.entries.findIndex(({ tag }) => tag.endsWith('_step_side_tables'));
  const prior = join(dir, 'prior');
  mkdirSync(join(prior, 'meta'), { recursive: true });
  const entries = split < 0 ? journal.entries : journal.entries.slice(0, split);
  writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const { tag } of entries) {
    copyFileSync(join(MIGRATIONS_FOLDER, `${tag}.sql`), join(prior, `${tag}.sql`));
  }

  const source = new Database(join(dir, 'live.db'));
  try {
    source.pragma('journal_mode = WAL');
    source.pragma('foreign_keys = ON');
    migrateDatabase(drizzle(source, { schema }), source, prior);
    for (const [status, data] of Object.entries(populated)) {
      const columns = Object.keys(data);
      const lease = status === 'claimed' ? ['test-machine', 17, 18] : [null, null, null];
      source
        .prepare(
          `INSERT INTO step (id, buildId, kind, status, createdAt, machineId, claimedAt, lastHeartbeatAt${columns.map((column) => `, "${column}"`).join('')}) VALUES (?, ?, ?, ?, ?, ?, ?, ?${columns.map(() => ', ?').join('')})`,
        )
        .run(status, 'test-build', 'code', status, 1, ...lease, ...Object.values(data));
    }
    const before = stepRows(source);
    const schemaObjects = stepSchemaObjects(source);
    const history = migrationHistory(source);
    const copy = join(dir, 'upgrade.db');
    await source.backup(copy);
    if (split >= 0) {
      const failedCopy = join(dir, 'interrupted.db');
      await source.backup(failedCopy);
      const { tag } = journal.entries[split]!;
      writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify(journal));
      for (const entry of journal.entries.slice(split)) {
        copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
      }
      const migration = join(prior, `${tag}.sql`);
      writeFileSync(
        migration,
        `${readFileSync(migration, 'utf8')}\n--> statement-breakpoint\nINSERT INTO missing_step_migration_test_table VALUES (1);`,
      );
      const interrupted = new Database(failedCopy);
      try {
        expect(() => migrateDatabase(drizzle(interrupted, { schema }), interrupted, prior)).toThrow(
          /missing_step_migration_test_table/,
        );
        expect(stepRows(interrupted)).toEqual(before);
        expect(stepSchemaObjects(interrupted)).toEqual(schemaObjects);
        expect(migrationHistory(interrupted)).toEqual(history);
        expect(
          interrupted.prepare("SELECT name FROM sqlite_schema WHERE name = 'step_quota'").get(),
        ).toBeUndefined();
      } finally {
        interrupted.close();
      }
    }

    const migrated = openDbWithHandle(copy);
    try {
      const { db, sqlite } = migrated;
      const moved = new Set(Object.values(groups).flat());
      const tables = sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as {
        name: string;
      }[];
      expect(tables.map(({ name }) => name)).toEqual(expect.arrayContaining(Object.keys(groups)));
      expect(
        Object.keys(getTableColumns(schema.step)).filter((column) => moved.has(column)),
      ).toEqual([]);
      expect(stepRows(sqlite)).toEqual(before);
      const retainedNames = new Set(schemaObjects.map(({ name }) => name));
      const nextSchema = stepSchemaObjects(sqlite);
      expect(nextSchema.filter(({ name }) => retainedNames.has(name))).toEqual(schemaObjects);
      expect(
        nextSchema.filter(({ name }) => !retainedNames.has(name)).map(({ name }) => name),
      ).toEqual([
        'step_require_writer_generation_delete',
        'step_require_writer_generation_insert',
        'step_require_writer_generation_update',
      ]);
      expect(migrationHistory(sqlite).slice(0, history.length)).toEqual(history);
      expect(migrationHistory(sqlite).length).toBeGreaterThan(history.length);
      expect(stepRows(source)).toEqual(before);
      for (const [table, columns] of Object.entries(groups)) {
        const expected = before
          .filter((row) => columns.some((column) => row[column] != null))
          .map((row) => ({
            stepId: row.id,
            ...Object.fromEntries(columns.map((column) => [column, row[column]])),
          }))
          .sort((a, b) => String(a.stepId).localeCompare(String(b.stepId)));
        expect(sqlite.prepare(`SELECT * FROM "${table}" ORDER BY stepId`).all()).toEqual(expected);
        expect(sqlite.pragma(`table_info(${table})`)).toContainEqual(
          expect.objectContaining({ name: 'stepId', notnull: 1, pk: 1 }),
        );
        expect(sqlite.pragma(`foreign_key_list(${table})`)).toEqual([
          expect.objectContaining({
            table: 'step',
            from: 'stepId',
            to: 'id',
            on_delete: 'CASCADE',
          }),
        ]);
      }
      expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
      const legacy = new Database(copy, { fileMustExist: true });
      try {
        expect(
          legacy.prepare('SELECT quotaBlock FROM step WHERE id = ?').get('waiting_quota'),
        ).toEqual({ quotaBlock: populated.waiting_quota.quotaBlock });
        expect(() =>
          legacy.prepare("UPDATE step SET status = 'pending' WHERE id = ?").run('waiting_quota'),
        ).toThrow(/cairn_step_write_generation/);
        expect(() =>
          legacy.prepare('UPDATE step SET quotaBlock = NULL WHERE id = ?').run('waiting_quota'),
        ).toThrow(/cairn_step_write_generation/);
        expect(() => legacy.prepare('DELETE FROM step WHERE id = ?').run('claimed')).toThrow(
          /cairn_step_write_generation/,
        );
        expect(() =>
          legacy
            .prepare(
              "INSERT INTO step (id, buildId, kind, createdAt) VALUES ('stale', 'build', 'code', 1)",
            )
            .run(),
        ).toThrow(/cairn_step_write_generation/);
        expect(() =>
          legacy.prepare("UPDATE agent_memory SET layer = 'searchable' WHERE layer = 'log'").run(),
        ).toThrow(/cairn_step_write_generation/);
        expect(stepRows(legacy)).toEqual(before);
      } finally {
        legacy.close();
      }
      heartbeatStep({ db }, 'test-machine', 'claimed');
      const lease = sqlite
        .prepare('SELECT status, claimedAt, lastHeartbeatAt FROM step WHERE id = ?')
        .get('claimed') as { status: string; claimedAt: number; lastHeartbeatAt: number };
      expect(lease).toMatchObject({ status: 'claimed', claimedAt: 17 });
      expect(lease.lastHeartbeatAt).toBeGreaterThan(18);
      const server = bootServer({ db });
      try {
        expect(
          listSteps(server, 'test-build').find(({ id }) => id === 'waiting_quota'),
        ).toMatchObject({ quotaWait: { providerId: 'test-provider' } });
        sqlite
          .prepare("UPDATE step_quota SET quotaBlock = NULL WHERE stepId = 'waiting_quota'")
          .run();
        expect(
          listSteps(server, 'test-build').find(({ id }) => id === 'waiting_quota')?.quotaWait,
        ).toBeUndefined();
      } finally {
        server.dispose();
      }
      expect(
        sqlite.prepare("SELECT quotaBlock FROM step WHERE id = 'waiting_quota'").get(),
      ).toEqual({
        quotaBlock: populated.waiting_quota.quotaBlock,
      });
      const leaseInput = {
        machineId: 'winner',
        claimedAt: 30,
        claimedRepo: null,
        claimedRepoId: null,
        skillInjection: { hits: [] },
        blockerHandoff: null,
        claudeSubscriptionId: 'winning-account',
        devinSubscriptionId: null,
        antigravitySubscriptionId: null,
        doubaoSubscriptionId: 'winning-doubao',
        ranModel: null,
        mcpGrant: null,
      };
      const pending = { id: 'pending', claimedAt: null };
      expect(db.transaction((tx) => acquireWorkerStepLease(tx, pending, leaseInput))).toEqual({
        claimedAt: 30,
      });
      expect(
        db.transaction((tx) =>
          acquireWorkerStepLease(tx, pending, {
            ...leaseInput,
            claimedAt: 31,
            machineId: 'loser',
            claudeSubscriptionId: 'losing-account',
            doubaoSubscriptionId: 'losing-doubao',
          }),
        ),
      ).toBeNull();
      expect(
        sqlite
          .prepare("SELECT claudeSubscriptionId FROM step_subscription WHERE stepId = 'pending'")
          .get(),
      ).toEqual({ claudeSubscriptionId: 'winning-account' });
      expect(
        sqlite
          .prepare(
            "SELECT claudeSubscriptionId, doubaoSubscriptionId FROM step WHERE id = 'pending'",
          )
          .get(),
      ).toEqual({ claudeSubscriptionId: null, doubaoSubscriptionId: 'winning-doubao' });
      sqlite.prepare("DELETE FROM step WHERE id IN ('claimed', 'failed', 'done')").run();
      for (const table of Object.keys(groups)) {
        expect(
          sqlite
            .prepare(`SELECT stepId FROM "${table}" WHERE stepId IN ('claimed', 'failed', 'done')`)
            .all(),
        ).toEqual([]);
      }
    } finally {
      migrated.close();
    }
    const restarted = openDbWithHandle(copy);
    try {
      expect(
        restarted.sqlite
          .prepare("SELECT quotaBlock FROM step_quota WHERE stepId = 'waiting_quota'")
          .get(),
      ).toEqual({ quotaBlock: null });
      expect(migrationHistory(restarted.sqlite)).toHaveLength(journal.entries.length);
    } finally {
      restarted.close();
    }
  } finally {
    source.close();
  }
});
