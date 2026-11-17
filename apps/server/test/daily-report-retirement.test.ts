import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { CHIEF_ROUTER_TOOLS } from '@cairn/shared';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect, onTestFinished, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import type { Db } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import {
  agentMemory,
  chief,
  chiefMessage,
  chiefReport,
  chiefThread,
  retroProposal,
  step,
  todo,
} from '../src/db/schema.js';
import { composeChiefSystemPrompt } from '../src/services/chief.js';
import { finishStep } from '../src/services/machines.js';
import { createScheduler } from '../src/services/scheduler.js';
import {
  bootServer,
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
  s.db
    .insert(chiefThread)
    .values({
      id: 'main',
      chiefId: 'chief',
      teamId: s.team.id,
      userId: s.user.id,
      title: 'Coordinator',
      createdAt: YESTERDAY,
      updatedAt: YESTERDAY,
      sessionId: '',
      sessionOpenedAt: YESTERDAY,
    })
    .run();
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
  expect(s.db.select().from(chiefReport).all()).toEqual([]);
  expect(s.db.select().from(retroProposal).all()).toEqual([]);
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

test.each(['running', 'retrying'] as const)(
  'a historical %s report is not resumed or rewritten after restart',
  async (status) => {
    const s = world();
    s.db
      .insert(chiefReport)
      .values({
        id: 'old-report',
        chiefId: 'chief',
        teamId: s.team.id,
        threadId: 'main',
        day: '2026-11-15',
        status,
        attempts: 1,
        createdAt: YESTERDAY,
      })
      .run();
    const before = s.db.select().from(chiefReport).all();
    for (const at of [MORNING, MORNING + 86_400_000]) {
      await createScheduler(s.svc, { tickMs: 15_000 }).tick(at);
    }
    expect(s.db.select().from(chiefReport).all()).toEqual(before);
    expect(s.db.select().from(step).all()).toEqual([]);
    expect(s.db.select().from(chiefMessage).all()).toEqual([]);
  },
);

test('old report decisions are unavailable and leave history and already-created tasks intact', async () => {
  const s = world();
  const projectId = await postProject(s.app, 'project');
  s.db
    .insert(chiefReport)
    .values({
      id: 'old-report',
      chiefId: 'chief',
      teamId: s.team.id,
      threadId: 'main',
      day: '2026-11-15',
      status: 'posted',
      createdAt: YESTERDAY,
    })
    .run();
  s.db
    .insert(retroProposal)
    .values({
      id: 'old-retro',
      reportId: 'old-report',
      teamId: s.team.id,
      projectId,
      title: 'Guard manual releases',
      what: 'A release was retried',
      why: 'Missing guard',
      safeguard: 'Add a check',
      sourceKind: 'coordinator',
      sourceId: 'old-message',
      sourceLabel: 'Coordinator',
      status: 'draft',
      createdAt: YESTERDAY,
    })
    .run();
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
  const before = s.db.select().from(retroProposal).all();
  const tasks = s.db.select().from(todo).all();
  for (const decision of ['accept', 'dismiss']) {
    const response = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/chief/retro-proposals/old-retro/${decision}`,
    );
    expect(response.status).toBe(404);
  }
  expect(s.db.select().from(retroProposal).all()).toEqual(before);
  expect(s.db.select().from(todo).all()).toEqual(tasks);
  expect(
    s.db.select().from(chiefReport).where(eq(chiefReport.id, 'old-report')).get(),
  ).toBeDefined();
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
      s.db
        .insert(chiefReport)
        .values({
          id: `report-${i}`,
          chiefId: 'chief',
          teamId: s.team.id,
          threadId: 'main',
          day: `2026-11-${10 + i}`,
          status: 'running',
          stepId: kind === 'report' ? `report-${status}` : null,
          createdAt: YESTERDAY,
        })
        .run();
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
    const reports = s.db.select().from(chiefReport).all();
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
      summary: 'pending',
      threshold: 'pending',
      'quoted-daily': 'pending',
      'multiline-quoted-daily': 'pending',
      'malformed-daily': 'pending',
      'whitespace-daily': 'pending',
      'nul-suffix-daily': 'pending',
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
    await finishStep(
      { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir },
      machineId,
      'report-claimed',
      {
        status: 'success',
        generation: YESTERDAY,
      },
    );
    expect(s.db.select().from(step).where(eq(step.id, 'report-claimed')).get()).toEqual(stopped);
    expect(s.db.select().from(chiefReport).all()).toEqual(reports);
    expect(s.db.select().from(retroProposal).all()).toEqual([]);
    expect(s.db.select().from(chiefMessage).all()).toEqual(messages);
    expect(s.db.select().from(agentMemory).all()).toEqual(memories);
    expect(s.db.select().from(chief).all()).toEqual(chiefs);
    migrateAll(sqlite);
    expect(s.db.select().from(chiefReport).all()).toEqual(reports);
  },
);
