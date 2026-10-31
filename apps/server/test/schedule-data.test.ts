import { scheduleRecordSchema, todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { schedule, team } from '../src/db/schema.js';
import { createScheduler } from '../src/services/scheduler.js';
import { computeNextRunAt, createSchedule } from '../src/services/schedules.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
const tz = 'Asia/Shanghai';

afterEach(() => {
  for (const server of servers.splice(0)) server.dispose();
});

async function setup() {
  const server = bootServer();
  servers.push(server);
  const projectId = await postProject(server.app, 'Schedule data');
  const created = await req(server.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Inspect the project',
    spec: 'Report recent changes',
  });
  expect(created.status).toBe(201);
  const todo = todoRecordSchema.parse(await created.json());
  return { ...server, projectId, todo };
}

describe('one schedule per todo', () => {
  test('a second creation replaces the stored schedule and resets run metadata', async () => {
    const s = await setup();
    const first = scheduleRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todo.id,
          kind: 'daily',
          at: Date.parse('2026-10-30T09:00:00+08:00'),
          tz,
        })
      ).json(),
    );
    s.db
      .update(schedule)
      .set({ lastRunAt: 1, lastRunStatus: 'failed', pausedReason: 'Unavailable' })
      .where(eq(schedule.id, first.id))
      .run();
    const replacement = await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todo.id,
      kind: 'weekly',
      at: Date.parse('2026-10-30T08:30:00+08:00'),
      tz,
      prompt: 'Report changes since the previous run',
      enabled: false,
    });
    expect(replacement.status).toBe(201);
    const record = scheduleRecordSchema.parse(await replacement.json());
    expect(s.db.select().from(schedule).all()).toHaveLength(1);
    expect(record.id).not.toBe(first.id);
    expect(record).toMatchObject({
      kind: 'weekly',
      cron: '30 8 * * 5',
      prompt: 'Report changes since the previous run',
      enabled: false,
      lastRunAt: null,
      lastRunStatus: null,
      pausedReason: null,
    });
    expect(await (await req(s.app, 'GET', '/api/schedules')).json()).toEqual([record]);
    expect(s.db.select().from(schedule).get()).toMatchObject({
      prompt: record.prompt,
      enabled: false,
      lastRunAt: null,
      lastRunStatus: null,
      pausedReason: null,
    });
  });

  test('another team cannot replace an existing schedule', async () => {
    const s = await setup();
    const input = {
      todoId: s.todo.id,
      kind: 'daily' as const,
      at: Date.parse('2026-10-30T09:00:00+08:00'),
      tz,
      teamId: s.team.id,
      createdBy: s.user.id,
    };
    const original = createSchedule(s.svc, input);
    s.db.insert(team).values({ id: 'other-team', name: 'Other team', createdAt: 1 }).run();
    expect(() => createSchedule(s.svc, { ...input, teamId: 'other-team' })).toThrow(/not found/);
    expect(await (await req(s.app, 'GET', '/api/schedules')).json()).toEqual([original]);
  });

  test('cron creation needs no anchor, stores fields and exposes persisted run metadata', async () => {
    const s = await setup();
    const response = await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todo.id,
      kind: 'cron',
      cron: '*/10 * * * *',
      prompt: 'Inspect recent changes',
      tz,
    });
    expect(response.status).toBe(201);
    const record = scheduleRecordSchema.parse(await response.json());
    expect(record).toMatchObject({
      kind: 'cron',
      cron: '*/10 * * * *',
      at: null,
      prompt: 'Inspect recent changes',
      enabled: true,
      lastRunAt: null,
      lastRunStatus: null,
      pausedReason: null,
    });
    const lastRunAt = Date.parse('2026-10-30T08:30:00+08:00');
    s.db
      .update(schedule)
      .set({ lastRunAt, lastRunStatus: 'failed', pausedReason: 'Unavailable' })
      .where(eq(schedule.id, record.id))
      .run();
    expect(await (await req(s.app, 'GET', '/api/schedules')).json()).toEqual([
      { ...record, lastRunAt, lastRunStatus: 'failed', pausedReason: 'Unavailable' },
    ]);
  });

  test.each([
    { kind: 'cron', cron: 'invalid' },
    { kind: 'cron', cron: '' },
    { kind: 'cron' },
    { kind: 'cron', cron: '61 * * * *' },
    { kind: 'cron', cron: '0 0 31 2 *' },
    { kind: 'cron', cron: '*/10 * * * *', tz: 'Invalid/Timezone' },
    { kind: 'daily', at: 0, cron: '*/10 * * * *' },
  ])('invalid cadence is rejected without replacing the existing row: %j', async (input) => {
    const s = await setup();
    const original = await (
      await req(s.app, 'POST', '/api/schedules', {
        todoId: s.todo.id,
        kind: 'once',
        at: Date.parse('2026-10-30T08:30:00+08:00'),
        tz,
      })
    ).json();
    const response = await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todo.id,
      tz,
      ...input,
    });
    expect(response.status).toBe(400);
    expect(await (await req(s.app, 'GET', '/api/schedules')).json()).toEqual([original]);
  });
});

describe('cron cadence in Asia/Shanghai', () => {
  test.each([
    {
      cron: '*/10 * * * *',
      from: '2026-10-30T23:50:00+08:00',
      expected: [
        '2026-10-31T00:00:00+08:00',
        '2026-10-31T00:10:00+08:00',
        '2026-10-31T00:20:00+08:00',
      ],
    },
    {
      cron: '30 8 * * 1-5',
      from: '2026-10-30T08:30:00+08:00',
      expected: [
        '2026-11-02T08:30:00+08:00',
        '2026-11-03T08:30:00+08:00',
        '2026-11-04T08:30:00+08:00',
      ],
    },
  ])('$cron returns the next three strictly later run times', ({ cron, from, expected }) => {
    let cursor = Date.parse(from);
    const actual = expected.map(() => {
      cursor = computeNextRunAt('cron', null, tz, cursor, cron);
      return cursor;
    });
    expect(actual).toEqual(expected.map((value) => Date.parse(value)));
  });

  test('cron advances after dispatch and after a busy todo is skipped', async () => {
    const s = await setup();
    const response = await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todo.id,
      kind: 'cron',
      cron: '*/10 * * * *',
      tz,
    });
    expect(response.status).toBe(201);
    const record = scheduleRecordSchema.parse(await response.json());
    const firstRun = record.nextRunAt as number;
    const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
    await scheduler.tick(firstRun);
    expect(s.db.select().from(schedule).get()?.nextRunAt).toBe(firstRun + 600_000);
    await scheduler.tick(firstRun + 600_000);
    expect(s.db.select().from(schedule).get()?.nextRunAt).toBe(firstRun + 1_200_000);
    const builds = await (await req(s.app, 'GET', `/api/projects/${s.projectId}/builds`)).json();
    expect(builds).toHaveLength(1);
  });

  test('a disabled due schedule does not dispatch or advance', async () => {
    const s = await setup();
    const response = await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todo.id,
      kind: 'daily',
      at: Date.parse('2026-10-30T08:30:00+08:00'),
      tz,
      enabled: false,
    });
    expect(response.status).toBe(201);
    const record = scheduleRecordSchema.parse(await response.json());
    await createScheduler(s.svc, { tickMs: 60_000 }).tick(record.nextRunAt as number);
    expect(await (await req(s.app, 'GET', `/api/projects/${s.projectId}/builds`)).json()).toEqual(
      [],
    );
    expect(s.db.select().from(schedule).get()?.nextRunAt).toBe(record.nextRunAt);
  });
  test('a stored cadence that no longer parses pauses the schedule without dispatching', async () => {
    const s = await setup();
    const response = await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todo.id,
      kind: 'cron',
      cron: '*/10 * * * *',
      tz,
    });
    expect(response.status).toBe(201);
    const record = scheduleRecordSchema.parse(await response.json());
    s.db.update(schedule).set({ cron: 'not a cron' }).where(eq(schedule.id, record.id)).run();
    const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
    await expect(scheduler.tick(record.nextRunAt as number)).resolves.toBeUndefined();
    await expect(scheduler.tick((record.nextRunAt as number) + 600_000)).resolves.toBeUndefined();
    expect(await (await req(s.app, 'GET', `/api/projects/${s.projectId}/builds`)).json()).toEqual(
      [],
    );
    expect(s.db.select().from(schedule).get()).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pausedReason: 'invalid schedule cron expression or timezone',
    });
  });
});
