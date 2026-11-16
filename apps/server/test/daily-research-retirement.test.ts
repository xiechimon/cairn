import { eq } from 'drizzle-orm';
import { expect, onTestFinished, test } from 'vitest';
import {
  build,
  chief,
  chiefMessage,
  chiefReport,
  chiefThread,
  retroProposal,
  todo,
} from '../src/db/schema.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer, insertMachine, postProject, req, seedSessionRoute } from './helpers.js';

test('daily ticks and a scheduler restart never create research, even with the retired option', async () => {
  const s = bootServer();
  onTestFinished(() => s.dispose());
  insertMachine(s);
  seedSessionRoute(s);
  const projectId = await postProject(s.app, 'project');
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
  const options = { tickMs: 60_000, researchIntakeProjectId: projectId };
  for (const at of ['2026-11-16T21:59:00Z', '2026-11-16T22:00:00Z', '2026-11-17T22:00:00Z']) {
    await createScheduler(s.svc, options).tick(Date.parse(at));
  }
  expect(s.db.select().from(todo).all()).toEqual([]);
  expect(s.db.select().from(build).all()).toEqual([]);
});

test('old intake drafts cannot create tasks and their stored data is left unchanged', async () => {
  const s = bootServer();
  onTestFinished(() => s.dispose());
  const projectId = await postProject(s.app, 'project');
  s.db
    .insert(chief)
    .values({ id: 'chief', teamId: s.team.id, userId: s.user.id, createdAt: 1 })
    .run();
  s.db
    .insert(chiefThread)
    .values({
      id: 'old-thread',
      chiefId: 'chief',
      teamId: s.team.id,
      userId: s.user.id,
      title: 'Coordinator',
      createdAt: 1,
      updatedAt: 1,
      sessionId: '',
      sessionOpenedAt: 1,
    })
    .run();
  s.db
    .insert(chiefReport)
    .values({
      id: 'old-report',
      chiefId: 'chief',
      teamId: s.team.id,
      threadId: 'old-thread',
      day: '2026-11-15',
      status: 'posted',
      createdAt: 1,
    })
    .run();
  s.db
    .insert(retroProposal)
    .values({
      id: 'old-intake',
      reportId: 'old-report',
      teamId: s.team.id,
      projectId,
      title: 'Release',
      what: 'Release',
      why: 'Project',
      safeguard: 'Upgrade',
      sourceKind: 'intake',
      sourceId: 'https://example.com/release',
      sourceLabel: 'example.com',
      status: 'draft',
      createdAt: 1,
    })
    .run();
  const before = s.db.select().from(retroProposal).where(eq(retroProposal.id, 'old-intake')).get();
  const response = await req(
    s.app,
    'POST',
    `/api/teams/${s.team.id}/chief/retro-proposals/old-intake/accept`,
  );
  expect(response.status).toBe(404);
  expect(s.db.select().from(todo).all()).toEqual([]);
  expect(s.db.select().from(retroProposal).where(eq(retroProposal.id, 'old-intake')).get()).toEqual(
    before,
  );
  s.db
    .insert(retroProposal)
    .values({ ...before!, id: 'ordinary-retro', sourceKind: 'coordinator' })
    .run();
  const historical = {
    kind: 'chief_daily_report',
    day: '2026-11-15',
    covers: '2026-11-14',
    status: 'posted',
    madeAt: 1,
    yesterday: {
      finished: [],
      finishedCount: 0,
      merged: [],
      mergedCount: 0,
      failed: [],
      failedCount: 0,
      retries: 0,
      quotaWaits: 0,
      verdicts: { pass: 0, block: 0 },
    },
    needsYou: { count: 0, todos: [], questions: 0 },
    retro: [],
    retroRan: true,
    truncated: [],
    intake: [{ id: 'old-intake', title: 'Historical release' }],
  };
  s.db
    .insert(chiefMessage)
    .values({
      id: 'chief-report-old-report',
      threadId: 'old-thread',
      role: 'system',
      content: JSON.stringify(historical),
      createdAt: 1,
    })
    .run();
  const accepted = await req(
    s.app,
    'POST',
    `/api/teams/${s.team.id}/chief/retro-proposals/ordinary-retro/accept`,
  );
  expect(accepted.status).toBe(200);
  const stored = s.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.id, 'chief-report-old-report'))
    .get();
  expect(JSON.parse(String(stored?.content))).toMatchObject({
    ...historical,
    retro: [expect.objectContaining({ id: 'ordinary-retro', status: 'accepted' })],
  });
  expect(s.db.select().from(todo).all()).toHaveLength(1);
});
