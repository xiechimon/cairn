import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, test } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

function migrateUpTo(sqlite: Database.Database, directory: string, lastTag: string): void {
  const cut = journal.entries.findIndex((entry) => entry.tag === lastTag);
  expect(cut).toBeGreaterThan(0);
  const prior = join(directory, 'prior');
  mkdirSync(join(prior, 'meta'), { recursive: true });
  const entries = journal.entries.slice(0, cut + 1);
  writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const entry of entries)
    copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
  migrate(drizzle(sqlite), { migrationsFolder: prior });
}

function seedThread(
  sqlite: Database.Database,
  row: { id: string; chiefId: string; projectId: string | null; updatedAt: number },
): void {
  sqlite
    .prepare(
      "INSERT INTO chief_thread (id, chiefId, userId, teamId, projectId, title, createdAt, updatedAt, sessionId, sessionOpenedAt) VALUES (@id, @chiefId, 'u1', 't1', @projectId, 'thread', 1, @updatedAt, 's', 1)",
    )
    .run(row);
}

function seedMessage(
  sqlite: Database.Database,
  row: { id: string; threadId: string; createdAt: number; projectId?: string | null },
): void {
  sqlite
    .prepare(
      "INSERT INTO chief_message (id, threadId, role, content, projectId, createdAt) VALUES (@id, @threadId, 'user', @content, @projectId, @createdAt)",
    )
    .run({ projectId: null, content: JSON.stringify(row.id), ...row });
}

test('per-project Coordinator threads merge into the one global thread per chief', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-coordinator-migration-'));
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, '0084_project_coordinator');
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('t1', 'Team', 1)");
    sqlite.exec(
      "INSERT INTO project (id, teamId, name) VALUES ('pa', 't1', 'A'), ('pb', 't1', 'B')",
    );
    const watches = JSON.stringify([
      { todoId: 'x', threadId: 'chief-proj-a', reason: 'r' },
      { todoId: 'y', threadId: 'chief-digest-chief-u1-t1', reason: 'r' },
    ]);
    const wakes = JSON.stringify([{ id: 'w1', at: 99, threadId: 'chief-old-global' }]);
    sqlite
      .prepare(
        "INSERT INTO chief (id, userId, teamId, createdAt, watches, wakes) VALUES ('chief-u1-t1', 'u1', 't1', 1, ?, ?), ('chief-u2-t1', 'u2', 't1', 1, '[]', '[]')",
      )
      .run(watches, wakes);
    seedThread(sqlite, {
      id: 'chief-global',
      chiefId: 'chief-u1-t1',
      projectId: null,
      updatedAt: 50,
    });
    seedThread(sqlite, {
      id: 'chief-old-global',
      chiefId: 'chief-u1-t1',
      projectId: null,
      updatedAt: 10,
    });
    seedThread(sqlite, {
      id: 'chief-proj-a',
      chiefId: 'chief-u1-t1',
      projectId: 'pa',
      updatedAt: 90,
    });
    seedThread(sqlite, {
      id: 'chief-proj-b',
      chiefId: 'chief-u1-t1',
      projectId: 'pb',
      updatedAt: 80,
    });
    seedThread(sqlite, {
      id: 'chief-digest-chief-u1-t1',
      chiefId: 'chief-u1-t1',
      projectId: null,
      updatedAt: 99,
    });
    seedThread(sqlite, {
      id: 'chief-u2-only',
      chiefId: 'chief-u2-t1',
      projectId: 'pb',
      updatedAt: 5,
    });
    seedMessage(sqlite, { id: 'g1', threadId: 'chief-global', createdAt: 100 });
    seedMessage(sqlite, { id: 'a1', threadId: 'chief-proj-a', createdAt: 110, projectId: 'pa' });
    seedMessage(sqlite, { id: 'a2', threadId: 'chief-proj-a', createdAt: 140 });
    seedMessage(sqlite, { id: 'b1', threadId: 'chief-proj-b', createdAt: 120 });
    seedMessage(sqlite, { id: 'g2', threadId: 'chief-global', createdAt: 130, projectId: 'pb' });
    sqlite
      .prepare(
        "INSERT INTO chief_message (id, threadId, role, content, createdAt) VALUES ('g2r', 'chief-global', 'assistant', '\"r\"', 131), ('user-o1', 'chief-old-global', 'user', '\"p\"', 91)",
      )
      .run();
    seedMessage(sqlite, { id: 'o1', threadId: 'chief-old-global', createdAt: 90 });
    seedMessage(sqlite, { id: 'd1', threadId: 'chief-digest-chief-u1-t1', createdAt: 95 });
    seedMessage(sqlite, { id: 'u1', threadId: 'chief-u2-only', createdAt: 7 });
    sqlite.pragma('foreign_keys = OFF');
    seedMessage(sqlite, { id: 'orphan', threadId: 'chief-gone', createdAt: 8 });
    sqlite.pragma('foreign_keys = ON');
    sqlite
      .prepare(
        "INSERT INTO step (id, buildId, kind, status, prompt, createdAt) VALUES ('queued-a', 'chief-proj-a', 'chief', 'pending', 'q', 1), ('quota-b', 'chief-proj-b', 'chief', 'waiting_quota', 'q', 2), ('running-a', 'chief-proj-a', 'chief', 'claimed', 'r', 3), ('done-a', 'chief-proj-a', 'chief', 'done', 'd', 4)",
      )
      .run();

    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });

    const active = sqlite
      .prepare(
        "SELECT id, chiefId, projectId, title FROM chief_thread WHERE archivedAt IS NULL AND id NOT LIKE 'chief-digest-%' ORDER BY chiefId",
      )
      .all();
    expect(active).toEqual([
      { id: 'chief-global', chiefId: 'chief-u1-t1', projectId: null, title: 'Coordinator' },
      { id: 'chief-u2-only', chiefId: 'chief-u2-t1', projectId: null, title: 'Coordinator' },
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT id, projectId FROM chief_message WHERE threadId = 'chief-global' ORDER BY createdAt, rowid",
        )
        .all(),
    ).toEqual([
      { id: 'o1', projectId: null },
      { id: 'user-o1', projectId: null },
      { id: 'g1', projectId: null },
      { id: 'a1', projectId: 'pa' },
      { id: 'b1', projectId: 'pb' },
      { id: 'g2', projectId: 'pb' },
      { id: 'g2r', projectId: 'pb' },
      { id: 'a2', projectId: 'pa' },
    ]);
    expect(
      sqlite.prepare("SELECT threadId, projectId FROM chief_message WHERE id = 'u1'").get(),
    ).toEqual({ threadId: 'chief-u2-only', projectId: 'pb' });
    expect(sqlite.prepare("SELECT threadId FROM chief_message WHERE id = 'orphan'").get()).toEqual({
      threadId: 'chief-gone',
    });
    expect(sqlite.prepare('SELECT id, buildId FROM step ORDER BY createdAt').all()).toEqual([
      { id: 'queued-a', buildId: 'chief-global' },
      { id: 'quota-b', buildId: 'chief-global' },
      { id: 'running-a', buildId: 'chief-proj-a' },
      { id: 'done-a', buildId: 'chief-proj-a' },
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT activeRun IS NOT NULL AS active FROM chief_thread WHERE id = 'chief-global'",
        )
        .get(),
    ).toEqual({ active: 1 });
    expect(sqlite.prepare("SELECT threadId FROM chief_message WHERE id = 'd1'").get()).toEqual({
      threadId: 'chief-digest-chief-u1-t1',
    });
    expect(
      sqlite
        .prepare(
          "SELECT id, projectId, archivedAt IS NOT NULL AS archived FROM chief_thread WHERE id IN ('chief-proj-a', 'chief-proj-b', 'chief-old-global', 'chief-digest-chief-u1-t1') ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: 'chief-digest-chief-u1-t1', projectId: null, archived: 0 },
      { id: 'chief-old-global', projectId: null, archived: 1 },
      { id: 'chief-proj-a', projectId: 'pa', archived: 1 },
      { id: 'chief-proj-b', projectId: 'pb', archived: 1 },
    ]);
    const chiefRow = sqlite
      .prepare("SELECT watches, wakes FROM chief WHERE id = 'chief-u1-t1'")
      .get() as { watches: string; wakes: string };
    expect(JSON.parse(chiefRow.watches)).toEqual([
      { todoId: 'x', threadId: 'chief-global', reason: 'r' },
      { todoId: 'y', threadId: 'chief-digest-chief-u1-t1', reason: 'r' },
    ]);
    expect(JSON.parse(chiefRow.wakes)).toEqual([{ id: 'w1', at: 99, threadId: 'chief-global' }]);
    expect(() =>
      seedThread(sqlite, {
        id: 'chief-second',
        chiefId: 'chief-u1-t1',
        projectId: null,
        updatedAt: 1,
      }),
    ).toThrow(/UNIQUE/);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a chief with only per-project threads keeps the newest one as its global thread', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-coordinator-migration-'));
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    migrateUpTo(sqlite, directory, '0084_project_coordinator');
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('t1', 'Team', 1)");
    sqlite.exec(
      "INSERT INTO chief (id, userId, teamId, createdAt) VALUES ('chief-u1-t1', 'u1', 't1', 1)",
    );
    seedThread(sqlite, { id: 'chief-a', chiefId: 'chief-u1-t1', projectId: 'pa', updatedAt: 20 });
    seedThread(sqlite, { id: 'chief-b', chiefId: 'chief-u1-t1', projectId: 'pb', updatedAt: 30 });
    seedMessage(sqlite, { id: 'a1', threadId: 'chief-a', createdAt: 1 });
    seedMessage(sqlite, { id: 'b1', threadId: 'chief-b', createdAt: 2 });
    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });
    expect(
      sqlite
        .prepare('SELECT id, projectId, archivedAt IS NULL AS active FROM chief_thread ORDER BY id')
        .all(),
    ).toEqual([
      { id: 'chief-a', projectId: 'pa', active: 0 },
      { id: 'chief-b', projectId: null, active: 1 },
    ]);
    expect(
      sqlite.prepare('SELECT id, threadId, projectId FROM chief_message ORDER BY createdAt').all(),
    ).toEqual([
      { id: 'a1', threadId: 'chief-b', projectId: 'pa' },
      { id: 'b1', threadId: 'chief-b', projectId: 'pb' },
    ]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
