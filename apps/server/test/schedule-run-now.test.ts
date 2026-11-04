import { eq } from 'drizzle-orm';
import { afterEach, expect, test, vi } from 'vitest';
import { agent, schedule, step, todo } from '../src/db/schema.js';
import * as builds from '../src/services/builds.js';
import { runScheduleNow } from '../src/services/schedule-run.js';
import { createSchedule, finishScheduledStep } from '../src/services/schedules.js';
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
  return { ...s, saved, todoId, buildId, stored, run, steps };
}

test('run now on an unknown schedule is 404', async () => {
  const s = await world();
  expect((await s.run('nope')).status).toBe(404);
});

test('run now fires the schedule once and records it like a scheduled run', async () => {
  const s = await world();
  const before = s.stored();
  const res = await s.run();
  expect(res.status).toBe(200);
  expect(s.steps()).toHaveLength(2);
  const after = s.stored();
  expect(after).toMatchObject({ lastRunStatus: 'started', lastRunError: null });
  expect(after.lastRunAt).not.toBeNull();
  expect(after.lastRunStepId).toBe(s.steps().find((r) => r.status === 'pending')?.id);
  expect(after.nextRunAt).toBe(before.nextRunAt);
  expect(((await res.json()) as { lastRunStatus: string }).lastRunStatus).toBe('started');
});

test('run now leaves a paused schedule paused and its reason intact', async () => {
  const s = await world();
  s.db
    .update(schedule)
    .set({ enabled: false, nextRunAt: null, pausedReason: 'Paused by you' })
    .where(eq(schedule.id, s.saved.id))
    .run();
  expect((await s.run()).status).toBe(200);
  expect(s.steps()).toHaveLength(2);
  expect(s.stored()).toMatchObject({
    enabled: false,
    nextRunAt: null,
    pausedReason: 'Paused by you',
    lastRunStatus: 'started',
  });
});

test('run now on an archived thread is 409 and dispatches nothing', async () => {
  const s = await world();
  s.db.update(todo).set({ archivedAt: Date.now() }).where(eq(todo.id, s.todoId)).run();
  const res = await s.run();
  expect(res.status).toBe(409);
  expect(await res.text()).toContain('archived');
  expect(s.steps()).toHaveLength(1);
  expect(s.stored().lastRunAt).toBeNull();
});

test('run now while the thread is running is 409 and does not preempt it', async () => {
  const s = await world();
  s.db.update(step).set({ status: 'claimed' }).where(eq(step.buildId, s.buildId)).run();
  const res = await s.run();
  expect(res.status).toBe(409);
  expect(s.steps()).toHaveLength(1);
});

test('two quick run-now posts dispatch exactly one run', async () => {
  const s = await world();
  const [a, b] = await Promise.all([s.run(), s.run()]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  expect(s.steps()).toHaveLength(2);
});

test('run now on a paused once schedule runs once and stays paused', async () => {
  const s = await world();
  s.db
    .update(schedule)
    .set({ kind: 'once', cron: null, at: Date.now() - 1000, enabled: false, nextRunAt: null })
    .where(eq(schedule.id, s.saved.id))
    .run();
  expect((await s.run()).status).toBe(200);
  expect(s.steps()).toHaveLength(2);
  expect(s.stored()).toMatchObject({ enabled: false, nextRunAt: null });
  finishScheduledStep(s.svc, s.steps().find((r) => r.status === 'pending')!);
  expect(s.stored()).toMatchObject({ lastRunStatus: 'completed', enabled: false });
});

test('run now on a pending once schedule consumes it so it cannot fire again', async () => {
  const s = await world();
  s.db
    .update(schedule)
    .set({
      kind: 'once',
      cron: null,
      at: Date.now() + 3_600_000,
      nextRunAt: Date.now() + 3_600_000,
    })
    .where(eq(schedule.id, s.saved.id))
    .run();
  expect((await s.run()).status).toBe(200);
  expect(s.stored().nextRunAt).toBeNull();
});

test('run now counts toward the worker run streak like a scheduled run and skips the gate delay', async () => {
  const s = await world('worker:seed');
  expect((await s.run()).status).toBe(200);
  expect(s.steps().filter((r) => r.scheduledBy === 'worker:seed')).toHaveLength(1);
});

test('run now on a worker schedule waiting at a gate phase is 409', async () => {
  const s = await world('worker:seed');
  s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, s.todoId)).run();
  const res = await s.run();
  expect(res.status).toBe(409);
  expect(s.steps()).toHaveLength(1);
});

test('a schedule from another team is 404 and dispatches nothing', async () => {
  const s = await world();
  await expect(runScheduleNow(s.svc, 'other-team', s.saved.id)).rejects.toMatchObject({
    status: 404,
  });
  expect(s.steps()).toHaveLength(1);
});
