import { eq } from 'drizzle-orm';
import { afterEach, expect, test, vi } from 'vitest';
import { agent, schedule, step, todo } from '../src/db/schema.js';
import * as builds from '../src/services/builds.js';
import { runScheduleNow } from '../src/services/schedule-run.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createSchedule } from '../src/services/schedules.js';
import { bootServer, insertMachine, postProject, req } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

async function world(createdBy?: string) {
  const s = bootServer();
  const machineId = insertMachine(s);
  s.db
    .insert(agent)
    .values({
      id: 'run-now-agent',
      teamId: s.team.id,
      displayName: 'Worker',
      provider: 'p',
      modelId: 'm',
      machineId,
    })
    .run();
  const projectId = await postProject(s.app, 'Run now');
  const response = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Check changes',
    spec: 'Keep checking',
  });
  const { id: todoId } = (await response.json()) as { id: string };
  const [started] = builds.startBuilds(s.svc, {
    projectId,
    todoIds: [todoId],
    assignment: { plan: null, build: { agentId: 'run-now-agent' } },
    withPlan: false,
  });
  const buildId = started!.id;
  const first = s.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
  s.db
    .update(step)
    .set({ status: 'done', machineId, sessionId: 'previous-session' })
    .where(eq(step.id, first.id))
    .run();
  s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, todoId)).run();
  const saved = createSchedule(s.svc, {
    teamId: s.team.id,
    createdBy: createdBy ?? s.user.id,
    todoId,
    prompt: 'Check again',
    tz: 'UTC',
    kind: 'cron',
    cron: '0 9 * * *',
  });
  const stored = () => s.db.select().from(schedule).where(eq(schedule.id, saved.id)).get()!;
  const run = (id = saved.id) => req(s.app, 'POST', `/api/schedules/${id}/run`, {});
  const steps = () => s.db.select().from(step).where(eq(step.buildId, buildId)).all();
  const scheduler = createScheduler(s.svc, { tickMs: 15_000 });
  return { ...s, scheduler, saved, todoId, buildId, stored, run, steps };
}

test('run now on an unknown schedule is 404', async () => {
  const s = await world();
  expect((await s.run('nope')).status).toBe(404);
});

test('a schedule from another team is 404 and changes nothing', async () => {
  const s = await world();
  const before = s.stored();
  expect(() => runScheduleNow(s.svc, 'other-team', s.saved.id)).toThrowError(/not found/);
  expect(s.stored()).toEqual(before);
});

test('run now makes a recurring schedule due and the next tick fires exactly one run', async () => {
  const s = await world();
  const res = await s.run();
  expect(res.status).toBe(200);
  const armed = s.stored();
  expect(armed.nextRunAt).toBeLessThanOrEqual(Date.now());
  expect(s.steps()).toHaveLength(1);
  await s.scheduler.tick(Date.now() + 1);
  expect(s.steps()).toHaveLength(2);
  const fired = s.stored();
  expect(fired).toMatchObject({ lastRunStatus: 'started', lastRunError: null });
  expect(fired.nextRunAt).toBeGreaterThan(Date.now());
  await s.scheduler.tick(Date.now() + 2);
  expect(s.steps()).toHaveLength(2);
});

test('run now clears a pending retry delay', async () => {
  const s = await world();
  s.db
    .update(schedule)
    .set({ nextRunAt: Date.now() - 1000, retryNotBefore: Date.now() + 300_000 })
    .where(eq(schedule.id, s.saved.id))
    .run();
  expect((await s.run()).status).toBe(200);
  expect(s.stored().retryNotBefore).toBeNull();
});

test('run now on a paused schedule is 409 and tells the user to resume it', async () => {
  const s = await world();
  s.db
    .update(schedule)
    .set({ enabled: false, nextRunAt: null, pausedReason: 'Paused by you' })
    .where(eq(schedule.id, s.saved.id))
    .run();
  const res = await s.run();
  expect(res.status).toBe(409);
  expect(await res.text()).toContain('paused; resume it first');
  expect(s.stored()).toMatchObject({ enabled: false, nextRunAt: null });
});

test('run now on an archived thread is 409', async () => {
  const s = await world();
  s.db.update(todo).set({ archivedAt: Date.now() }).where(eq(todo.id, s.todoId)).run();
  const res = await s.run();
  expect(res.status).toBe(409);
  expect(await res.text()).toContain('archived');
  expect(s.stored().nextRunAt).toBe(s.saved.nextRunAt);
});

test('run now while the thread is running is 409 and leaves nextRunAt alone', async () => {
  const s = await world();
  s.db.update(step).set({ status: 'claimed' }).where(eq(step.buildId, s.buildId)).run();
  expect((await s.run()).status).toBe(409);
  expect(s.stored().nextRunAt).toBe(s.saved.nextRunAt);
});

test('a second run-now post while the schedule is already due is 409 and one tick runs once', async () => {
  const s = await world();
  const [a, b] = [await s.run(), await s.run()];
  expect([a.status, b.status]).toEqual([200, 409]);
  await s.scheduler.tick(Date.now() + 1);
  expect(s.steps()).toHaveLength(2);
});

test('run now re-arms a finished once schedule for now', async () => {
  const s = await world();
  s.db
    .update(schedule)
    .set({
      kind: 'once',
      cron: null,
      at: Date.now() - 60_000,
      nextRunAt: null,
      lastRunStatus: 'completed',
    })
    .where(eq(schedule.id, s.saved.id))
    .run();
  expect((await s.run()).status).toBe(200);
  expect(s.stored().nextRunAt).toBeLessThanOrEqual(Date.now());
  await s.scheduler.tick(Date.now() + 1);
  expect(s.steps()).toHaveLength(2);
  expect(s.stored().nextRunAt).toBeNull();
});

test('run now on a worker schedule still obeys the worker gate at the tick', async () => {
  const s = await world('worker:seed');
  s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, s.todoId)).run();
  expect((await s.run()).status).toBe(200);
  await s.scheduler.tick(Date.now() + 1);
  expect(s.steps()).toHaveLength(1);
});
