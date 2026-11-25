import { ASK_USER_QUESTION_KIND, scheduleRecordSchema, todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { build, message, plan, schedule, step, todo } from '../src/db/schema.js';
import * as builds from '../src/services/builds.js';
import { setProjectArchived } from '../src/services/projects.js';
import { runScheduleNow } from '../src/services/schedule-run.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createSchedule, setScheduleClockListener } from '../src/services/schedules.js';
import {
  bootServer,
  insertMachine,
  postProject,
  req,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

const servers: TestServer[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) s.dispose();
});

async function setup(kind: 'cron' | 'once' = 'cron') {
  const s = bootServer();
  servers.push(s);
  const machineId = insertMachine(s);
  seedSessionRoute(s, { provider: 'p', modelId: 'm', machineId });
  const projectId = await postProject(s.app, 'Schedule reliability');
  const createdTodo = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Scheduled work',
    spec: 'Inspect repository state',
  });
  expect(createdTodo.status).toBe(201);
  const todoRow = todoRecordSchema.parse(await createdTodo.json());
  const [started] = builds.startBuilds(s.svc, { projectId, todoIds: [todoRow.id] });
  const buildId = started!.id;
  const firstStep = s.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
  s.db
    .update(step)
    .set({ status: 'done', machineId, sessionId: 'sess-1' })
    .where(eq(step.id, firstStep.id))
    .run();
  s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, todoRow.id)).run();
  const saved = createSchedule(s.svc, {
    teamId: s.team.id,
    createdBy: s.user.id,
    todoId: todoRow.id,
    prompt: 'Check status',
    tz: 'UTC',
    ...(kind === 'cron'
      ? { kind: 'cron', cron: '*/15 * * * *' }
      : { kind: 'once', at: Math.ceil((Date.now() + 900_000) / 900_000) * 900_000 }),
  });
  const events: object[] = [];
  const unsubscribe = s.hub.subscribe(s.team.id, {
    send: async (payload) => {
      events.push(payload);
    },
  });
  const stored = () => s.db.select().from(schedule).where(eq(schedule.id, saved.id)).get()!;
  const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
  return {
    ...s,
    projectId,
    todoId: todoRow.id,
    buildId,
    firstStep,
    saved,
    due: saved.nextRunAt!,
    events,
    unsubscribe,
    stored,
    scheduler,
  };
}

describe('schedule confirm and needs_input gate protection', () => {
  test('owner schedule skips a task waiting in confirm without cancelling its build or plan and broadcasts SSE', async () => {
    const s = await setup('cron');
    s.db.update(step).set({ kind: 'plan' }).where(eq(step.id, s.firstStep.id)).run();
    s.db
      .insert(plan)
      .values({
        id: 'plan-1',
        buildId: s.buildId,
        content: 'Proposed plan',
        createdAt: s.due - 1000,
      })
      .run();
    s.db
      .update(todo)
      .set({ phase: 'confirm', phaseAt: s.due - 1000 })
      .where(eq(todo.id, s.todoId))
      .run();
    s.events.length = 0;

    await s.scheduler.tick(s.due);

    expect(s.db.select().from(build).all()).toHaveLength(1);
    expect(s.db.select().from(build).where(eq(build.id, s.buildId)).get()?.errorMessage).toBeNull();
    expect(s.db.select().from(step).all()).toHaveLength(1);
    expect(s.db.select().from(todo).where(eq(todo.id, s.todoId)).get()?.phase).toBe('confirm');
    expect(s.stored()).toMatchObject({
      enabled: true,
      pausedReason: null,
      lastRunStatus: 'skipped',
      lastRunError: expect.stringMatching(/confirm/i),
      nextRunAt: s.due + 900_000,
    });
    expect(s.events).toContainEqual(
      expect.objectContaining({ type: 'schedule', scheduleId: s.saved.id }),
    );
    s.unsubscribe();
  });

  test('owner schedule skips a task waiting in needs_input without bypassing the pending question and broadcasts SSE', async () => {
    const s = await setup('once');
    s.db
      .update(todo)
      .set({ phase: 'needs_input', phaseAt: s.due - 1000 })
      .where(eq(todo.id, s.todoId))
      .run();
    s.db
      .insert(message)
      .values({
        id: 'pending-q',
        conversationId: s.buildId,
        role: 'assistant',
        createdAt: s.due - 1000,
        content: {
          kind: ASK_USER_QUESTION_KIND,
          requestId: 'pending-q',
          status: 'pending',
          questions: [{ header: 'Choice', question: 'Proceed?', options: [] }],
          answers: null,
        },
      })
      .run();
    s.events.length = 0;

    await s.scheduler.tick(s.due);

    expect(s.db.select().from(step).all()).toHaveLength(1);
    expect(s.db.select().from(todo).where(eq(todo.id, s.todoId)).get()?.phase).toBe('needs_input');
    expect(s.stored()).toMatchObject({
      enabled: true,
      pausedReason: null,
      lastRunStatus: 'skipped',
      lastRunError: expect.stringMatching(/answer|input/i),
      nextRunAt: null,
    });
    expect(s.events).toContainEqual(
      expect.objectContaining({ type: 'schedule', scheduleId: s.saved.id }),
    );
    s.unsubscribe();
  });
});

describe('schedule SSE on missed windows, failures, and auto-pauses', () => {
  test('missed-run window skip broadcasts a schedule SSE event', async () => {
    const s = await setup('cron');
    const overdue = s.due - 13 * 60 * 60_000;
    s.db
      .update(schedule)
      .set({ createdAt: overdue - 60_000, nextRunAt: overdue })
      .where(eq(schedule.id, s.saved.id))
      .run();
    s.events.length = 0;

    await s.scheduler.tick(s.due);

    expect(s.stored()).toMatchObject({
      lastRunStatus: 'skipped',
      lastRunError: 'missed the run window',
    });
    expect(s.events).toContainEqual(
      expect.objectContaining({ type: 'schedule', scheduleId: s.saved.id }),
    );
    s.unsubscribe();
  });

  test('permanent start failure auto-pauses and broadcasts a schedule SSE event', async () => {
    const s = await setup('cron');
    vi.spyOn(builds, 'sendBuildSteer').mockRejectedValueOnce(new Error('Invalid API key'));
    s.events.length = 0;

    await s.scheduler.tick(s.due);

    expect(s.stored()).toMatchObject({
      enabled: false,
      lastRunStatus: 'failed',
      pausedReason: 'Invalid API key',
    });
    expect(s.events).toContainEqual(
      expect.objectContaining({ type: 'schedule', scheduleId: s.saved.id }),
    );
    s.unsubscribe();
  });
});

describe('archived project and task schedule safety', () => {
  test('archiving a project via HTTP pauses its active schedules and blocks resuming until unarchived', async () => {
    const s = await setup('cron');
    s.events.length = 0;

    const archiveRes = await req(s.app, 'POST', `/api/projects/${s.projectId}/archive`, {});
    expect(archiveRes.status).toBe(200);
    expect(s.stored()).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pausedReason: 'Project archived',
    });
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'schedule' }));

    const resumeWhileArchived = await req(s.app, 'PATCH', `/api/schedules/${s.saved.id}`, {
      enabled: true,
    });
    expect(resumeWhileArchived.status).toBe(409);
    expect(await resumeWhileArchived.text()).toMatch(/archived project/i);
    expect(s.stored().enabled).toBe(false);

    const putWhileArchived = await req(s.app, 'PUT', `/api/schedules/${s.saved.id}`, {
      todoId: s.todoId,
      kind: 'cron',
      cron: '*/15 * * * *',
      tz: 'UTC',
      enabled: true,
    });
    expect(putWhileArchived.status).toBe(409);

    expect((await req(s.app, 'POST', `/api/projects/${s.projectId}/unarchive`, {})).status).toBe(
      200,
    );
    expect(s.stored().enabled).toBe(false);
    const resumeAfterUnarchive = await req(s.app, 'PATCH', `/api/schedules/${s.saved.id}`, {
      enabled: true,
    });
    expect(resumeAfterUnarchive.status).toBe(200);
    expect(scheduleRecordSchema.parse(await resumeAfterUnarchive.json()).enabled).toBe(true);
    s.unsubscribe();
  });

  test('setProjectArchived pauses active project schedules and resuming an archived task schedule is rejected with 409', async () => {
    const s = await setup('cron');
    setProjectArchived(s.db, s.projectId, true);
    expect(s.stored()).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pausedReason: 'Project archived',
    });

    setProjectArchived(s.db, s.projectId, false);
    expect((await req(s.app, 'POST', `/api/todos/${s.todoId}/archive`, {})).status).toBe(200);
    const resumeArchivedTask = await req(s.app, 'PATCH', `/api/schedules/${s.saved.id}`, {
      enabled: true,
    });
    expect(resumeArchivedTask.status).toBe(409);
    expect(await resumeArchivedTask.text()).toMatch(/archived thread/i);
    s.unsubscribe();
  });
});

describe('runScheduleNow clock wake and off-grid once editing', () => {
  test('runScheduleNow immediately notifies the schedule clock listener and emits SSE', async () => {
    const s = await setup('cron');
    const wake = vi.fn();
    setScheduleClockListener(s.db, wake);
    s.events.length = 0;

    runScheduleNow(s.svc, s.team.id, s.saved.id);

    expect(wake).toHaveBeenCalledOnce();
    expect(s.events).toContainEqual(
      expect.objectContaining({ type: 'schedule', scheduleId: s.saved.id }),
    );
    setScheduleClockListener(s.db, null);
    s.unsubscribe();
  });

  test('PUT /api/schedules/:id preserves an existing off-grid once minute without returning 400', async () => {
    const s = await setup('once');
    const offGridAt = Date.UTC(2026, 10, 10, 9, 7);
    const created = createSchedule(
      s.svc,
      {
        teamId: s.team.id,
        createdBy: s.user.id,
        todoId: s.todoId,
        kind: 'once',
        at: offGridAt,
        tz: 'UTC',
        prompt: 'Initial',
      },
      { allowAnyMinute: true },
    );

    const updated = await req(s.app, 'PUT', `/api/schedules/${created.id}`, {
      todoId: s.todoId,
      kind: 'once',
      at: offGridAt,
      tz: 'UTC',
      prompt: 'Updated prompt',
      enabled: true,
    });
    expect(updated.status).toBe(200);
    expect(scheduleRecordSchema.parse(await updated.json())).toMatchObject({
      id: created.id,
      at: offGridAt,
      prompt: 'Updated prompt',
    });
    s.unsubscribe();
  });
});
