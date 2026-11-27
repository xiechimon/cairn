import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { orchestrationSourceRef } from '@cairn/shared';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import { machine, step } from '../src/db/schema.js';
import { claimStep } from '../src/services/machine-claim.js';
import { openResearchThread } from '../src/services/research-thread.js';
import {
  bootServer,
  insertClaudeSubscription,
  postProject,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

const disposables: TestServer[] = [];
afterEach(() => {
  for (const s of disposables.splice(0)) s.dispose();
});

describe('0263 retire info-card pipeline & schedule migration', () => {
  test('0262 -> 0263 migrates orchestration info schedules onto same-team unarchived threads, keeps event/orphaned/cross-team on code todos, preserves done info todos, and enforces SQL XOR check', () => {
    const directory = makeTestTempDir('cairn-retire-info-card-');
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite);
    try {
      const cut = journal.entries.findIndex(
        (entry) => entry.tag === '0263_retire_info_card_schedules',
      );
      expect(cut).toBeGreaterThan(0);
      const prior = join(directory, 'prior');
      mkdirSync(join(prior, 'meta'), { recursive: true });
      const entries = journal.entries.slice(0, cut);
      writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
      for (const entry of entries) {
        copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
      }
      migrate(db, { migrationsFolder: prior });

      sqlite.exec(`
        INSERT INTO user (id, displayName) VALUES ('u1', 'Owner');
        INSERT INTO team (id, name, createdAt) VALUES ('team-a', 'Team A', 1), ('team-b', 'Team B', 1);
        INSERT INTO chief (id, userId, teamId, createdAt) VALUES ('chief-a', 'u1', 'team-a', 1), ('chief-b', 'u1', 'team-b', 1);
        INSERT INTO project (id, teamId, name) VALUES ('proj-a', 'team-a', 'Proj A'), ('proj-arch', 'team-a', 'Proj Arch'), ('proj-b', 'team-b', 'Proj B');
        INSERT INTO chief_thread (id, chiefId, userId, teamId, projectId, title, createdAt, updatedAt, sessionId, sessionOpenedAt) VALUES
          ('chief-thread-live', 'chief-a', 'u1', 'team-a', 'proj-a', 'Daily Concierge', 1, 1, '', 1),
          ('chief-thread-arch', 'chief-a', 'u1', 'team-a', 'proj-arch', 'Old Concierge', 1, 1, '', 1),
          ('chief-thread-other-team', 'chief-b', 'u1', 'team-b', 'proj-b', 'Team B Concierge', 1, 1, '', 1);
        UPDATE chief_thread SET archivedAt = 10 WHERE id = 'chief-thread-arch';
        INSERT INTO todo (id, teamId, projectId, title, spec, phase, phaseAt, seqNum, output, sourceKind, sourceRef) VALUES
          ('todo-orch-info', 'team-a', 'proj-a', 'Competitors', '每天早上 9 点帮我总结竞品新功能', 'review', 1, 1, 'info', 'orchestration', '${orchestrationSourceRef('chief-thread-live')}'),
          ('todo-event-info', 'team-a', 'proj-a', 'Event Watch', 'Watch build finish', 'todo', 1, 2, 'report', 'orchestration', '${orchestrationSourceRef('chief-thread-live')}'),
          ('todo-arch-info', 'team-a', 'proj-a', 'Orphaned', 'Archived thread task', 'queued', 1, 3, 'info', 'orchestration', '${orchestrationSourceRef('chief-thread-arch')}'),
          ('todo-xteam-info', 'team-a', 'proj-a', 'Cross Team', 'Bad link', 'todo', 1, 4, 'info', 'orchestration', '${orchestrationSourceRef('chief-thread-other-team')}'),
          ('todo-done-info', 'team-a', 'proj-a', 'Done Hist', 'Past report', 'done', 1, 5, 'report', 'orchestration', '${orchestrationSourceRef('chief-thread-live')}'),
          ('todo-unfinished-dataset', 'team-a', 'proj-a', 'Active Dataset', 'Collect data', 'building', 1, 6, 'dataset', NULL, NULL),
          ('todo-research', 'team-a', 'proj-a', 'CI Stuck Research', 'Investigate CI', 'queued', 1, 7, 'info', 'research-stuck', 'b1:1'),
          ('todo-code', 'team-a', 'proj-a', 'Regular Code', 'Fix bug', 'todo', 1, 8, 'code', NULL, NULL);
        INSERT INTO schedule (id, teamId, projectId, todoId, kind, cron, prompt, enabled, at, tz, webhookTokenHash, webhookMasked, createdAt, nextRunAt, lastRunAt, lastRunStatus, createdBy) VALUES
          ('sched-orch', 'team-a', 'proj-a', 'todo-orch-info', 'daily', '0 9 * * *', '', 1, 1000, 'Asia/Shanghai', NULL, NULL, 10, 2000, 1500, 'completed', 'u1'),
          ('sched-event', 'team-a', 'proj-a', 'todo-event-info', 'event', NULL, 'On done', 1, NULL, 'UTC', NULL, NULL, 10, NULL, NULL, NULL, 'u1'),
          ('sched-arch', 'team-a', 'proj-a', 'todo-arch-info', 'daily', '0 8 * * *', 'Still run', 1, 1000, 'UTC', NULL, NULL, 10, 3000, NULL, NULL, 'u1'),
          ('sched-xteam', 'team-a', 'proj-a', 'todo-xteam-info', 'daily', '0 7 * * *', 'Stay safe', 1, 1000, 'UTC', NULL, NULL, 10, 4000, NULL, NULL, 'u1'),
          ('sched-code', 'team-a', 'proj-a', 'todo-code', 'webhook', NULL, 'Trigger', 1, NULL, 'UTC', 'hash-1', 'cairn-wh-a', 10, NULL, 900, 'completed', 'u1');
      `);

      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const schedOrch = sqlite
        .prepare("SELECT * FROM schedule WHERE id = 'sched-orch'")
        .get() as Record<string, unknown>;
      expect(schedOrch).toMatchObject({
        teamId: 'team-a',
        projectId: 'proj-a',
        todoId: null,
        chiefThreadId: 'chief-thread-live',
        kind: 'daily',
        cron: '0 9 * * *',
        prompt: '每天早上 9 点帮我总结竞品新功能',
        nextRunAt: 2000,
        lastRunAt: 1500,
        lastRunStatus: 'completed',
      });

      const schedEvent = sqlite
        .prepare("SELECT todoId, chiefThreadId, prompt FROM schedule WHERE id = 'sched-event'")
        .get();
      expect(schedEvent).toEqual({
        todoId: 'todo-event-info',
        chiefThreadId: null,
        prompt: 'On done',
      });
      const schedArch = sqlite
        .prepare("SELECT todoId, chiefThreadId FROM schedule WHERE id = 'sched-arch'")
        .get();
      expect(schedArch).toEqual({ todoId: 'todo-arch-info', chiefThreadId: null });
      const schedXteam = sqlite
        .prepare("SELECT todoId, chiefThreadId FROM schedule WHERE id = 'sched-xteam'")
        .get();
      expect(schedXteam).toEqual({ todoId: 'todo-xteam-info', chiefThreadId: null });

      const schedCode = sqlite
        .prepare("SELECT * FROM schedule WHERE id = 'sched-code'")
        .get() as Record<string, unknown>;
      expect(schedCode).toMatchObject({
        id: 'sched-code',
        todoId: 'todo-code',
        chiefThreadId: null,
        webhookTokenHash: 'hash-1',
        webhookMasked: 'cairn-wh-a',
        lastRunStatus: 'completed',
      });

      const outputOf = (id: string) =>
        (sqlite.prepare('SELECT output FROM todo WHERE id = ?').get(id) as { output: string })
          .output;
      expect(outputOf('todo-event-info')).toBe('code');
      expect(outputOf('todo-arch-info')).toBe('code');
      expect(outputOf('todo-xteam-info')).toBe('code');
      expect(outputOf('todo-unfinished-dataset')).toBe('code');
      expect(outputOf('todo-done-info')).toBe('report');
      expect(outputOf('todo-research')).toBe('info');
      expect(outputOf('todo-code')).toBe('code');

      expect(sqlite.prepare('PRAGMA index_list(schedule)').all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'schedule_todoId_unique', unique: 1 }),
          expect.objectContaining({ name: 'schedule_webhookTokenHash_unique', unique: 1 }),
          expect.objectContaining({ name: 'schedule_nextRunAt_idx', unique: 0 }),
          expect.objectContaining({ name: 'schedule_chiefThreadId_idx', unique: 0 }),
        ]),
      );

      expect(() =>
        sqlite.exec(
          "INSERT INTO schedule (id, teamId, projectId, todoId, chiefThreadId, kind, tz, createdBy) VALUES ('bad-both', 'team-a', 'proj-a', 't1', 'chief-thread-live', 'daily', 'UTC', 'u1')",
        ),
      ).toThrow();
      expect(() =>
        sqlite.exec(
          "INSERT INTO schedule (id, teamId, projectId, todoId, chiefThreadId, kind, tz, createdBy) VALUES ('bad-none', 'team-a', 'proj-a', NULL, NULL, 'daily', 'UTC', 'u1')",
        ),
      ).toThrow();

      expect(() => {
        sqlite.exec('BEGIN');
        sqlite.exec("UPDATE schedule SET prompt = 'mutated' WHERE id = 'sched-code'");
        sqlite.exec(
          "INSERT INTO schedule (id, teamId, projectId, todoId, chiefThreadId, kind, tz, createdBy) VALUES ('bad-tx', 'team-a', 'proj-a', NULL, NULL, 'daily', 'UTC', 'u1')",
        );
        sqlite.exec('COMMIT');
      }).toThrow();
      if (sqlite.inTransaction) sqlite.exec('ROLLBACK');
      expect(sqlite.prepare("SELECT prompt FROM schedule WHERE id = 'sched-code'").get()).toEqual({
        prompt: 'Trigger',
      });
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('retired info-card runner/tools/protocol files are removed while openResearchThread still claims session steps on plain host runners', async () => {
    for (const rel of [
      'apps/server/src/coordinator/runtime/info-card-runner.ts',
      'apps/server/src/coordinator/runtime/info-card-guard.ts',
      'apps/server/src/services/info-card.ts',
      'apps/server/src/services/info-card-tools.ts',
      'apps/server/src/services/info-repo-snapshot.ts',
      'packages/shared/src/protocol/info-card-tools.ts',
      'apps/server/src/services/machine-repo-archive.ts',
      'apps/daemon/src/repo-archive.ts',
    ]) {
      expect(existsSync(join(REPO_ROOT, rel))).toBe(false);
    }

    const s = bootServer();
    disposables.push(s);
    insertClaudeSubscription(s);
    s.db
      .insert(machine)
      .values(
        readyMachine({
          id: 'plain-mac',
          teamId: s.team.id,
          name: 'Plain Mac',
          online: true,
          claudeCodeReport: { installed: true, hostname: 'Plain Mac', models: [] },
          capabilities: {
            mcpServers: [],
            skills: [],
            executor: 'host',
            computer: false,
            browser: false,
          },
        }),
      )
      .run();
    const projectId = await postProject(s.app, 'research-plain');
    seedSessionRoute(s, { machineId: 'plain-mac' });
    const opened = openResearchThread(s.svc, {
      teamId: s.team.id,
      projectId,
      title: 'Check CI flake',
      question: 'Why did vitest fail?',
      tier: 1,
    });
    const claimed = await claimStep(
      {
        ...s.svc,
        box: s.secretBox,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
      },
      'plain-mac',
      s.team.id,
      0,
      'http://localhost',
    );
    expect(claimed?.step.buildId).toBe(opened.buildId);
    const stepRow = s.db.select().from(step).where(eq(step.buildId, opened.buildId)).get();
    expect(stepRow?.status).toBe('claimed');
  });
});
