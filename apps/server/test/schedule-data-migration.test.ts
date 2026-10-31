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

test.each(['fresh', 'upgrade'])(
  '%s database enforces one schedule and retains the latest duplicate',
  (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'cairn-schedule-data-'));
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite);
    try {
      const cut = journal.entries.findIndex((entry) => entry.tag === '0071_schedule_data');
      expect(cut).toBeGreaterThan(0);
      expect(journal.entries[cut]!.when).toBeGreaterThan(journal.entries[cut - 1]!.when);
      if (mode === 'upgrade') {
        const prior = join(directory, 'prior');
        mkdirSync(join(prior, 'meta'), { recursive: true });
        const entries = journal.entries.slice(0, cut);
        writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
        for (const entry of entries) {
          copyFileSync(
            join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
            join(prior, `${entry.tag}.sql`),
          );
        }
        migrate(db, { migrationsFolder: prior });
        sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)");
        sqlite.exec(
          "INSERT INTO schedule (id, teamId, projectId, todoId, kind, at, tz, nextRunAt, createdBy) VALUES ('old', 'team', 'project', 'todo', 'daily', 1, 'Asia/Shanghai', 2, 'user'), ('latest', 'team', 'project', 'todo', 'weekly', 3, 'Asia/Shanghai', 4, 'user'), ('other', 'team', 'project', 'other-todo', 'once', 5, 'Asia/Shanghai', 5, 'user')",
        );
      }
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(sqlite.prepare('PRAGMA table_info(schedule)').all()).toEqual(
        expect.arrayContaining(
          ['cron', 'prompt', 'enabled', 'lastRunAt', 'lastRunStatus', 'pausedReason'].map((name) =>
            expect.objectContaining({ name }),
          ),
        ),
      );
      expect(sqlite.prepare('PRAGMA index_list(schedule)').all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'schedule_todoId_unique', unique: 1 }),
        ]),
      );
      if (mode === 'fresh') {
        sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)");
        sqlite.exec(
          "INSERT INTO schedule (id, teamId, projectId, todoId, kind, at, tz, nextRunAt, createdBy) VALUES ('latest', 'team', 'project', 'todo', 'weekly', 3, 'Asia/Shanghai', 4, 'user')",
        );
      }
      expect(sqlite.prepare("SELECT * FROM schedule WHERE todoId = 'todo'").all()).toEqual([
        {
          id: 'latest',
          teamId: 'team',
          projectId: 'project',
          todoId: 'todo',
          kind: 'weekly',
          at: 3,
          tz: 'Asia/Shanghai',
          nextRunAt: 4,
          createdBy: 'user',
          cron: null,
          prompt: '',
          enabled: 1,
          lastRunAt: null,
          lastRunStatus: null,
          lastRunError: null,
          lastRunStepId: null,
          retryNotBefore: null,
          pausedReason: null,
        },
      ]);
      if (mode === 'upgrade')
        expect(sqlite.prepare("SELECT id FROM schedule WHERE todoId = 'other-todo'").get()).toEqual(
          { id: 'other' },
        );
      expect(() =>
        sqlite.exec(
          "INSERT INTO schedule (id, teamId, projectId, todoId, kind, tz, createdBy) VALUES ('duplicate', 'team', 'project', 'todo', 'daily', 'Asia/Shanghai', 'user')",
        ),
      ).toThrow(/UNIQUE constraint failed: schedule.todoId/);
      sqlite.exec(
        "UPDATE schedule SET cron = '*/10 * * * *', prompt = 'Inspect changes', enabled = 0, lastRunAt = 6, lastRunStatus = 'failed', pausedReason = 'Unavailable' WHERE id = 'latest'",
      );
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(
        sqlite
          .prepare(
            "SELECT cron, prompt, enabled, lastRunAt, lastRunStatus, pausedReason FROM schedule WHERE id = 'latest'",
          )
          .get(),
      ).toEqual({
        cron: '*/10 * * * *',
        prompt: 'Inspect changes',
        enabled: 0,
        lastRunAt: 6,
        lastRunStatus: 'failed',
        pausedReason: 'Unavailable',
      });
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
