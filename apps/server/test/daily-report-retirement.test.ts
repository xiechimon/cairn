import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { CHIEF_ROUTER_TOOLS } from '@cairn/shared';
import Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect, onTestFinished, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import type { Db } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { agentMemory, chief, chiefMessage, chiefThread, step, todo } from '../src/db/schema.js';
import { composeChiefSystemPrompt } from '../src/services/chief.js';

import { createScheduler } from '../src/services/scheduler.js';
import {
  bootServer,
  finishStepForClaim,
  insertMachineIntoOldSchema,
  insertStepIntoOldSchema,
  postProject,
  req,
  seedRoute,
  stepRowsRaw,
} from './helpers.js';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

const YESTERDAY = Date.parse('2026-11-15T12:00:00+08:00');
const MORNING = Date.parse('2026-11-16T08:01:00+08:00');

function world(db?: Db) {
  const s = bootServer({ db });
  onTestFinished(() => s.dispose());
  seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'stub-model' });
  s.db
    .insert(chief)
    .values({
      id: 'chief',
      teamId: s.team.id,
      userId: s.user.id,
      tz: 'Asia/Singapore',
      createdAt: 1,
    })
    .run();
  s.db.run(sql`INSERT INTO chief_thread
    (id, chiefId, teamId, userId, title, createdAt, updatedAt, sessionId, sessionOpenedAt)
    VALUES ('main', 'chief', ${s.team.id}, ${s.user.id}, 'Coordinator',
      ${YESTERDAY}, ${YESTERDAY}, '', ${YESTERDAY})`);
  return s;
}

test('daily ticks and scheduler restarts create no reports, summaries or memory passes', async () => {
  const s = world();
  s.db
    .insert(chiefMessage)
    .values({
      id: 'yesterday-message',
      threadId: 'main',
      role: 'user',
      content: 'Keep the release manual.',
      createdAt: YESTERDAY,
    })
    .run();
  for (const at of [MORNING, MORNING + 60_000, MORNING + 86_400_000]) {
    await createScheduler(s.svc, { tickMs: 15_000 }).tick(at);
  }
  expect(
    s.db.all(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('chief_report', 'retro_proposal')`,
    ),
  ).toEqual([]);
  const steps = s.db.select().from(step).all();
  expect(steps).toEqual([]);
  expect(
    s.db
      .select()
      .from(chiefMessage)
      .all()
      .filter((m) => m.id.startsWith('chief-report-')),
  ).toEqual([]);
});

test('old report decisions are unavailable and already-created tasks are intact', async () => {
  const s = world();
  const projectId = await postProject(s.app, 'project');
  s.db
    .insert(todo)
    .values({
      id: 'already-created',
      projectId,
      teamId: s.team.id,
      title: 'Previous suggestion',
      seqNum: 1,
      phaseAt: YESTERDAY,
    })
    .run();
  const tasks = s.db.select().from(todo).all();
  for (const decision of ['accept', 'dismiss']) {
    const response = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/chief/retro-proposals/old-retro/${decision}`,
    );
    expect(response.status).toBe(404);
  }
  expect(s.db.select().from(todo).all()).toEqual(tasks);
});

test('the Coordinator no longer advertises daily reports or their decision tool', () => {
  const s = world();
  expect(CHIEF_ROUTER_TOOLS.map((tool) => tool.name)).not.toContain('decide_report_suggestion');
  expect(composeChiefSystemPrompt(s.svc, s.team.id)).not.toContain('日报');
});

test.each(['report', 'daily'] as const)(
  'an upgrade stops active %s steps and discards a late Runner result',
  async (kind) => {
    const directory = makeTestTempDir('daily-report-retirement-');
    const sqlite = new Database(join(directory, 'db.sqlite'));
    onTestFinished(() => {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    });
    migrateUpTo(sqlite, directory, '0176_retire_research_jobs');
    const s = world(drizzle(sqlite, { schema }));
    const machineId = insertMachineIntoOldSchema(sqlite, s.team.id);
    for (const [i, status] of (['pending', 'claimed', 'done', 'failed'] as const).entries()) {
      insertStepIntoOldSchema(sqlite, [
        {
          id: `report-${status}`,
          buildId: 'chief-digest-chief',
          kind: 'chief',
          status,
          machineId: status === 'pending' ? null : machineId,
          claimedAt: status === 'pending' ? null : YESTERDAY,
          createdAt: YESTERDAY,
          prompt:
            kind === 'daily'
              ? `Conversation\0with earlier binary text\nDigest thread=main until=${YESTERDAY} last=yesterday-message reason=daily`
              : null,
        },
      ]);
      sqlite.exec(
        `INSERT INTO chief_report (id, chiefId, teamId, threadId, day, status, stepId, createdAt)
         VALUES ('report-${i}', 'chief', '${s.team.id}', 'main', '2026-11-${10 + i}', 'running',
                 ${kind === 'report' ? `'report-${status}'` : 'NULL'}, ${YESTERDAY})`,
      );
    }
    const controls = [
      ['summary', null],
      [
        'threshold',
        `Conversation\nDigest thread=main until=${YESTERDAY} last=yesterday-message reason=threshold`,
      ],
      ['quoted-daily', 'User quote reason=daily'],
      [
        'multiline-quoted-daily',
        `Conversation\nDigest thread=main until=${YESTERDAY} last=yesterday-message reason=threshold\nUser quote reason=daily`,
      ],
      [
        'malformed-daily',
        `Conversation\nDigest thread=main until=${YESTERDAY}junk last=yesterday-message reason=daily`,
      ],
      [
        'whitespace-daily',
        `Conversation\nDigest thread=main\tother until=${YESTERDAY} last=yesterday-message reason=daily`,
      ],
      [
        'nul-suffix-daily',
        `Conversation\nDigest thread=main until=${YESTERDAY} last=yesterday-message reason=daily\0junk`,
      ],
    ] as const;
    insertStepIntoOldSchema(
      sqlite,
      controls.map(([id, prompt]) => ({
        id,
        prompt,
        buildId: 'chief-digest-chief',
        kind: 'chief' as const,
        status: 'pending' as const,
        createdAt: YESTERDAY,
      })),
    );
    insertStepIntoOldSchema(sqlite, [
      {
        id: 'ordinary',
        buildId: 'task-build',
        kind: 'session',
        status: 'claimed',
        machineId,
        createdAt: YESTERDAY,
      },
    ]);
    const ended = stepRowsRaw(sqlite).filter((row) =>
      ['done', 'failed'].includes(row.status as string),
    );
    migrateAll(sqlite);
    expect(
      Object.fromEntries(
        s.db
          .select()
          .from(step)
          .all()
          .map((row) => [row.id, row.status]),
      ),
    ).toEqual({
      'report-pending': 'stopped',
      'report-claimed': 'stopped',
      'report-done': 'done',
      'report-failed': 'failed',
      summary: 'stopped',
      threshold: 'stopped',
      'quoted-daily': 'stopped',
      'multiline-quoted-daily': 'stopped',
      'malformed-daily': 'stopped',
      'whitespace-daily': 'stopped',
      'nul-suffix-daily': 'stopped',
      ordinary: 'claimed',
    });
    expect(
      stepRowsRaw(sqlite).filter((row) => ['done', 'failed'].includes(row.status as string)),
    ).toMatchObject(ended);
    const stopped = s.db.select().from(step).where(eq(step.id, 'report-claimed')).get();
    s.db
      .insert(chiefThread)
      .values({
        id: 'chief-digest-chief',
        chiefId: 'chief',
        teamId: s.team.id,
        userId: s.user.id,
        title: 'Historical report run',
        createdAt: YESTERDAY,
        updatedAt: YESTERDAY,
        sessionId: '',
        sessionOpenedAt: YESTERDAY,
      })
      .run();
    s.db
      .insert(chiefMessage)
      .values({
        id: 'late-output',
        threadId: 'chief-digest-chief',
        role: 'assistant',
        content: JSON.stringify({
          items: [{ group: 'remembered', text: 'Late fact', reason: 'Late result' }],
          retro: [{ title: 'Late draft', what: 'Late report' }],
          memory: { merges: [], expire: [] },
        }),
        createdAt: MORNING,
      })
      .run();
    const messages = s.db.select().from(chiefMessage).all();
    const memories = s.db.select().from(agentMemory).all();
    const chiefs = s.db.select().from(chief).all();
    await finishStepForClaim(
      { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir },
      machineId,
      'report-claimed',
      {
        status: 'success',
        generation: YESTERDAY,
      },
    );
    const absent = () =>
      s.db.all(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('chief_report', 'retro_proposal')`,
      );
    expect(s.db.select().from(step).where(eq(step.id, 'report-claimed')).get()).toEqual(stopped);
    expect(absent()).toEqual([]);
    expect(s.db.select().from(chiefMessage).all()).toEqual(messages);
    expect(s.db.select().from(agentMemory).all()).toEqual(memories);
    expect(s.db.select().from(chief).all()).toEqual(chiefs);
    migrateAll(sqlite);
    expect(absent()).toEqual([]);
  },
);
