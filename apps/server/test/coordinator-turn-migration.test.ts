import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

test('the upgrade links each Coordinator-owned task to its latest wake so a finished turn can hand it over', () => {
  const directory = makeTestTempDir('cairn-coordinator-turn-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  const db = drizzle(sqlite);
  try {
    const cut = journal.entries.findIndex((entry) => entry.tag.endsWith('_coordinator_turn'));
    expect(cut).toBeGreaterThan(0);
    const prior = join(directory, 'prior');
    mkdirSync(join(prior, 'meta'), { recursive: true });
    const entries = journal.entries.slice(0, cut);
    writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries)
      copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
    migrate(db, { migrationsFolder: prior });
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)");
    sqlite.exec("INSERT INTO project (id, teamId, name) VALUES ('project', 'team', 'Project')");
    const insertTodo = sqlite.prepare(
      "INSERT INTO todo (id, teamId, projectId, title, phase, phaseAt, seqNum, lastNotifiedOwner, lastNotifiedWork) VALUES (?, 'team', 'project', 'Task', 'failed', 1, ?, ?, ?)",
    );
    insertTodo.run('owned', 1, 'coordinator', 'failed:b:1');
    insertTodo.run('unwoken', 2, 'coordinator', 'failed:c:1');
    insertTodo.run('mine', 3, 'owner', 'confirm:d:1');
    const insertWake = sqlite.prepare(
      "INSERT INTO step (id, buildId, kind, status, prompt, createdAt) VALUES (?, 'thread', 'chief', 'done', ?, ?)",
    );
    insertWake.run('old-wake', '[wake:failed] provenance=watch:owned\nold', 10);
    insertWake.run('new-wake', '[wake:failed] provenance=watch:owned\nnew', 20);
    insertWake.run('mine-wake', '[wake:gate] provenance=watch:mine\nx', 30);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const turns = Object.fromEntries(
      (
        sqlite.prepare('SELECT id, coordinatorTurn FROM todo ORDER BY id').all() as {
          id: string;
          coordinatorTurn: string | null;
        }[]
      ).map((row) => [
        row.id,
        row.coordinatorTurn === null ? null : JSON.parse(row.coordinatorTurn),
      ]),
    );
    expect(turns).toEqual({
      mine: null,
      owned: { stepId: 'new-wake', workKey: 'failed:b:1' },
      unwoken: null,
    });
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
