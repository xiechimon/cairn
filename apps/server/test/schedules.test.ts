import {
  type BuildRecord,
  type ScheduleRecord,
  scheduleRecordSchema,
  type TodoRecord,
  todoRecordSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { machine as machineTable, todo as todoTable } from '../src/db/schema.js';
import { completeStep, listSteps } from '../src/services/builds.js';
import { createScheduler } from '../src/services/scheduler.js';
import { serverTimezone, wallClockParts } from '../src/services/schedules.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

const TZ = 'Asia/Shanghai';

const servers: TestServer[] = [];
function boot() {
  const s = bootServer();
  servers.push(s);
  return s;
}
afterEach(() => {
  while (servers.length > 0) servers.pop()?.dispose();
});

async function withTodo(title = '每天巡检 r3-lifecycle') {
  const s = boot();
  const projectId = await postProject(s.app, 'r3-lifecycle');
  const todoDoc = todoRecordSchema.parse(
    await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title, spec: '巡检 README' })
    ).json(),
  );
  const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
  return { ...s, projectId, todoDoc, scheduler };
}

async function buildsOf(s: TestServer, projectId: string): Promise<BuildRecord[]> {
  return (await (
    await req(s.app, 'GET', `/api/projects/${projectId}/builds`)
  ).json()) as BuildRecord[];
}

async function todoOf(s: TestServer, todoId: string): Promise<TodoRecord> {
  return todoRecordSchema.parse(await (await req(s.app, 'GET', `/api/todos/${todoId}`)).json());
}

async function runToReview(s: TestServer, projectId: string, todoId: string): Promise<string> {
  const started = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: null, build: null },
      withPlan: false,
    })
  ).json()) as { builds: BuildRecord[] };
  const buildId = started.builds[0]?.id as string;
  setTodoPhase(s.svc, todoId, 'building');
  completeStep(s.svc, listSteps(s.svc, buildId)[0]?.id as string);
  return buildId;
}

async function runToDone(s: TestServer, projectId: string, todoId: string): Promise<void> {
  const buildId = await runToReview(s, projectId, todoId);
  await req(s.app, 'POST', `/api/builds/${buildId}/merge`);
  const steps = listSteps(s.svc, buildId);
  completeStep(s.svc, steps[steps.length - 1]?.id as string);
}

describe('schedule CRUD (record = the r3 §8.3 measured shape)', () => {
  test('POST /api/schedules once -> 201 ScheduleRecord (at=nextRunAt, with an embedded todo summary)', async () => {
    const s = await withTodo();
    const at = new Date('2026-09-24T14:30:00+08:00').getTime();
    const res = await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todoDoc.id,
      kind: 'once',
      at,
      tz: TZ,
    });
    expect(res.status).toBe(201);
    const record = scheduleRecordSchema.parse(await res.json());
    expect(record).toMatchObject({
      teamId: s.team.id,
      projectId: s.projectId,
      todoId: s.todoDoc.id,
      kind: 'once',
      at,
      tz: TZ,
      nextRunAt: at,
      createdBy: s.user.id,
    });
    expect(record.todo).toEqual({
      seqNum: s.todoDoc.seqNum,
      title: s.todoDoc.title,
      phase: 'todo',
      projectName: 'r3-lifecycle',
      ownerId: s.user.id,
    });
  });

  test('GET /api/schedules?team= (parameter name team, the 02 §6.1 measured shape); unknown team 404', async () => {
    const s = await withTodo();
    await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todoDoc.id,
      kind: 'once',
      at: new Date('2026-09-24T00:00:00+08:00').getTime(),
      tz: TZ,
    });
    const list = (await (
      await req(s.app, 'GET', `/api/schedules?team=${s.team.id}`)
    ).json()) as ScheduleRecord[];
    expect(list).toHaveLength(1);
    expect(scheduleRecordSchema.safeParse(list[0]).success).toBe(true);
    expect((await req(s.app, 'GET', '/api/schedules?team=nope')).status).toBe(404);
  });

  test('DELETE /api/schedules/{id} -> 204; deleting again 404 (DELETE_FACE [inferred] same name)', async () => {
    const s = await withTodo();
    const created = (await (
      await req(s.app, 'POST', '/api/schedules', {
        todoId: s.todoDoc.id,
        kind: 'once',
        at: new Date('2026-09-24T00:00:00+08:00').getTime(),
        tz: TZ,
      })
    ).json()) as ScheduleRecord;
    expect((await req(s.app, 'DELETE', `/api/schedules/${created.id}`)).status).toBe(204);
    expect((await req(s.app, 'DELETE', `/api/schedules/${created.id}`)).status).toBe(404);
    const list = (await (await req(s.app, 'GET', '/api/schedules')).json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  test('validation surface: a once-schedule minute outside the slots 400 (the four 00/15/30/45 slots, r5 §8); a bad body 400; an unknown todo 404', async () => {
    const s = await withTodo();
    await expect(
      req(s.app, 'POST', '/api/schedules', {
        todoId: s.todoDoc.id,
        kind: 'once',
        at: new Date('2026-09-24T14:07:00+08:00').getTime(),
        tz: TZ,
      }).then(async (r) => {
        expect(r.status).toBe(400);
        expect(Object.keys((await r.json()) as Record<string, unknown>)).toEqual(['error']);
      }),
    ).resolves.toBeUndefined();
    expect(
      (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          kind: 'daily',
          at: new Date('2026-09-01T09:05:00+08:00').getTime(),
          tz: TZ,
        })
      ).status,
    ).toBe(201);
    for (const minute of [0, 15, 30, 45]) {
      const at = new Date(`2026-09-24T14:${String(minute).padStart(2, '0')}:00+08:00`).getTime();
      const res = await req(s.app, 'POST', '/api/schedules', {
        todoId: s.todoDoc.id,
        kind: 'once',
        at,
        tz: TZ,
      });
      expect(res.status, `minute ${minute}`).toBe(201);
    }
    expect(
      (await req(s.app, 'POST', '/api/schedules', { todoId: s.todoDoc.id, kind: 'once' })).status,
    ).toBe(400);
    expect(
      (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: 'nope',
          kind: 'once',
          at: new Date('2026-09-24T00:00:00+08:00').getTime(),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          projectId: 'other-project',
          kind: 'once',
          at: new Date('2026-09-24T00:00:00+08:00').getTime(),
        })
      ).status,
    ).toBe(400);
  });

  test('tz default = the server local timezone (the tz note says it runs in your local timezone (...), 01 §4.2)', async () => {
    const s = await withTodo();
    const now = Date.now();
    const at = Math.ceil((now + 3_600_000) / 900_000) * 900_000;
    const record = scheduleRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/schedules', { todoId: s.todoDoc.id, kind: 'once', at })
      ).json(),
    );
    expect(record.tz).toBe(serverTimezone());
  });
});

describe('periodic-slot nextRunAt (cron tz-aware; the hourly/daily/weekly enum words [inferred] 02 §6.2)', () => {
  test('daily: the next fire = 14:30 wall clock in tz, strictly after the creation time', async () => {
    const s = await withTodo();
    const anchor = new Date('2026-09-01T14:30:00+08:00').getTime();
    const t0 = Date.now();
    const record = scheduleRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          kind: 'daily',
          at: anchor,
          tz: TZ,
        })
      ).json(),
    );
    const next = record.nextRunAt as number;
    expect(next).toBeGreaterThan(t0);
    expect(next - t0).toBeLessThanOrEqual(24 * 3_600_000 + 60_000);
    const parts = wallClockParts(next, TZ);
    expect(parts).toMatchObject({ hour: 14, minute: 30 });
    expect(next % 1000).toBe(0);
  });

  test('hourly: the next fire = minute 45 of every hour (the slot anchor)', async () => {
    const s = await withTodo();
    const anchor = new Date('2026-09-01T09:45:00+08:00').getTime();
    const t0 = Date.now();
    const record = scheduleRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          kind: 'hourly',
          at: anchor,
          tz: TZ,
        })
      ).json(),
    );
    const next = record.nextRunAt as number;
    expect(next).toBeGreaterThan(t0);
    expect(next - t0).toBeLessThanOrEqual(3_600_000 + 60_000);
    expect(wallClockParts(next, TZ).minute).toBe(45);
  });

  test('weekly: the next fire = the anchor weekday + wall clock (Wednesday 09:00)', async () => {
    const s = await withTodo();
    const anchor = new Date('2026-09-23T09:00:00+08:00').getTime();
    const record = scheduleRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          kind: 'weekly',
          at: anchor,
          tz: TZ,
        })
      ).json(),
    );
    const next = record.nextRunAt as number;
    const nextDate = new Date(next);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(
      nextDate,
    );
    expect(weekday).toBe('Wed');
    expect(wallClockParts(next, TZ)).toMatchObject({ hour: 9, minute: 0 });
    expect(next - Date.now()).toBeLessThanOrEqual(7 * 24 * 3_600_000 + 60_000);
  });
});

describe('the trigger loop E2E (04 §4 M2: trigger -> a fresh rerun in a new build, r3 §9)', () => {
  test('a once schedule due at tick -> a new build triggerSource:"schedule" + the todo queued + auto dequeue', async () => {
    const s = await withTodo();
    const at = new Date('2026-09-23T00:00:00+08:00').getTime();
    await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todoDoc.id,
      kind: 'once',
      at,
      tz: TZ,
    });
    s.scheduler.tick();
    const builds = await buildsOf(s, s.projectId);
    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject({
      todoId: s.todoDoc.id,
      triggerSource: 'schedule',
      withPlan: false,
      prevPhase: 'todo',
    });
    const t = await todoOf(s, s.todoDoc.id);
    expect(t.phase).toBe('queued');
    expect(t.latestBuildId).toBe(builds[0]?.id);
    const list = (await (await req(s.app, 'GET', '/api/schedules')).json()) as unknown[];
    expect(list).toEqual([]);
    const steps = listSteps(s.svc, builds[0]?.id as string);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe('build');
  });

  test('a done rerun (the r3 §9 measurement: finished -> a fresh rerun at the due time, back to the executing -> awaiting-review semantics)', async () => {
    const s = await withTodo();
    await runToDone(s, s.projectId, s.todoDoc.id);
    expect((await todoOf(s, s.todoDoc.id)).phase).toBe('done');
    await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todoDoc.id,
      kind: 'once',
      at: new Date('2026-09-23T00:00:00+08:00').getTime(),
      tz: TZ,
    });
    s.scheduler.tick();
    const builds = await buildsOf(s, s.projectId);
    expect(builds).toHaveLength(2);
    const rerun = builds.find((b) => b.triggerSource === 'schedule');
    expect(rerun?.prevPhase).toBe('done');
    expect((await todoOf(s, s.todoDoc.id)).phase).toBe('queued');
    expect((await todoOf(s, s.todoDoc.id)).buildHistory).toHaveLength(2);
  });

  test('a review-sojourn round displaced: the old build errorMessage:"Cancelled" (the r5 §8 measurement)', async () => {
    const s = await withTodo();
    const oldBuildId = await runToReview(s, s.projectId, s.todoDoc.id);
    expect((await todoOf(s, s.todoDoc.id)).phase).toBe('review');
    await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todoDoc.id,
      kind: 'once',
      at: new Date('2026-09-23T00:00:00+08:00').getTime(),
      tz: TZ,
    });
    s.scheduler.tick();
    const oldBuild = (await (await req(s.app, 'GET', `/api/builds/${oldBuildId}`)).json()) as
      | BuildRecord
      | { error: string };
    expect(oldBuild).toMatchObject({ id: oldBuildId, errorMessage: 'Cancelled' });
    const t = await todoOf(s, s.todoDoc.id);
    expect(t.phase).toBe('queued');
    const builds = await buildsOf(s, s.projectId);
    expect(builds.find((b) => b.triggerSource === 'schedule')?.prevPhase).toBe('review');
  });

  test('a periodic slot rolls nextRunAt after firing (the row kept, with a once-dequeued control group)', async () => {
    const s = await withTodo();
    const anchor = new Date('2026-09-01T00:00:00+08:00').getTime();
    const created = scheduleRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          kind: 'hourly',
          at: anchor,
          tz: TZ,
        })
      ).json(),
    );
    const firstNext = created.nextRunAt as number;
    s.scheduler.tick(firstNext + 1_000);
    const after = scheduleRecordSchema.parse(
      ((await (await req(s.app, 'GET', '/api/schedules')).json()) as ScheduleRecord[])[0],
    );
    expect(after.id).toBe(created.id);
    expect(after.nextRunAt as number).toBeGreaterThan(firstNext);
    expect(wallClockParts(after.nextRunAt as number, TZ).minute).toBe(0);
    expect((await buildsOf(s, s.projectId))[0]?.triggerSource).toBe('schedule');
  });

  test('an in-progress phase is not preempted: skipped this round, the periodic slot still rolls [design]', async () => {
    const s = await withTodo();
    await req(s.app, 'POST', `/api/projects/${s.projectId}/builds`, {
      todoIds: [s.todoDoc.id],
      assignment: { plan: null, build: null },
      withPlan: false,
    });
    s.db
      .insert(machineTable)
      .values({
        id: 'machine-schedule-no-preempt',
        teamId: s.team.id,
        name: 'sched-box',
        online: true,
      })
      .run();
    const anchor = new Date('2026-09-01T00:15:00+08:00').getTime();
    const created = scheduleRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          kind: 'hourly',
          at: anchor,
          tz: TZ,
        })
      ).json(),
    );
    s.scheduler.tick((created.nextRunAt as number) + 1_000);
    expect(await buildsOf(s, s.projectId)).toHaveLength(1);
    expect((await todoOf(s, s.todoDoc.id)).phase).toBe('queued');
    const after = scheduleRecordSchema.parse(
      ((await (await req(s.app, 'GET', '/api/schedules')).json()) as ScheduleRecord[])[0],
    );
    expect(after.nextRunAt as number).toBeGreaterThan(created.nextRunAt as number);
  });

  test('orphan self-healing: the todo already deleted -> dequeued [design]', async () => {
    const s = await withTodo();
    await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todoDoc.id,
      kind: 'once',
      at: new Date('2026-09-23T00:00:00+08:00').getTime(),
      tz: TZ,
    });
    s.db.delete(todoTable).where(eq(todoTable.id, s.todoDoc.id)).run();
    s.scheduler.tick();
    const list = (await (await req(s.app, 'GET', '/api/schedules')).json()) as unknown[];
    expect(list).toEqual([]);
    expect(await buildsOf(s, s.projectId)).toHaveLength(0);
  });
});
