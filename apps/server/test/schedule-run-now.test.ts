import { eq } from 'drizzle-orm';
import { afterEach, expect, test, vi } from 'vitest';
import { dueEvent, project, schedule, step, todo } from '../src/db/schema.js';
import * as builds from '../src/services/builds.js';
import * as ciLoop from '../src/services/ci-loop.js';
import type { DueClock } from '../src/services/due-events.js';
import { runScheduleNow } from '../src/services/schedule-run.js';
import { createScheduler } from '../src/services/scheduler.js';
import {
  createSchedule,
  recordScheduleFailure,
  updateSchedule,
} from '../src/services/schedules.js';
import { bootServer, insertMachine, postProject, req, seedSessionRoute } from './helpers.js';

class FakeClock implements DueClock {
  time: number;
  private queue: Array<{ at: number; cb: () => void | Promise<void> }> = [];

  constructor(time: number) {
    this.time = time;
  }

  now(): number {
    return this.time;
  }

  setTimer(callback: () => void | Promise<void>, delayMs: number): unknown {
    const timer = { at: this.time + delayMs, cb: callback };
    this.queue.push(timer);
    return timer;
  }

  clearTimer(handle: unknown): void {
    this.queue = this.queue.filter((timer) => timer !== handle);
  }

  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      const next = [...this.queue].sort((left, right) => left.at - right.at)[0];
      if (!next || next.at > target) break;
      this.queue = this.queue.filter((timer) => timer !== next);
      this.time = next.at;
      await next.cb();
    }
    this.time = target;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function world(createdBy?: string) {
  const s = bootServer();
  const machineId = insertMachine(s);
  seedSessionRoute(s, { provider: 'p', modelId: 'm', machineId });
  const projectId = await postProject(s.app, 'Run now');
  const response = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Check changes',
    spec: 'Keep checking',
  });
  const { id: todoId } = (await response.json()) as { id: string };
  const [started] = builds.startBuilds(s.svc, {
    projectId,
    todoIds: [todoId],
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
  return { ...s, scheduler, saved, projectId, todoId, buildId, stored, run, steps };
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

test('run now on an archived project is 409 and leaves the schedule unchanged', async () => {
  const s = await world();
  s.db.update(project).set({ archivedAt: Date.now() }).where(eq(project.id, s.projectId)).run();
  const before = s.stored();
  const res = await s.run();
  expect(res.status).toBe(409);
  expect(await res.text()).toContain('archived project');
  expect(s.stored()).toEqual(before);
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

test('run now fires immediately before tickMs even when a future due_event already exists', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-09-24T10:00:00Z') });
  const s = await world();
  const clock = new FakeClock(Date.now());
  const scheduler = createScheduler(s.svc, { tickMs: 60_000, clock });
  scheduler.start();
  try {
    await clock.advance(0);
    const armedEvent = s.db
      .select()
      .from(dueEvent)
      .where(eq(dueEvent.id, `schedule:${s.saved.id}`))
      .get();
    expect(armedEvent?.dueAt).toBe(s.saved.nextRunAt);
    expect(armedEvent?.dueAt).toBeGreaterThan(clock.now() + 60_000);

    expect((await s.run()).status).toBe(200);
    await clock.advance(100);
    expect(s.steps()).toHaveLength(2);
    expect(s.stored().nextRunAt).toBeGreaterThan(clock.now());
    const nextEvent = s.db
      .select()
      .from(dueEvent)
      .where(eq(dueEvent.id, `schedule:${s.saved.id}`))
      .get();
    expect(nextEvent?.dueAt).toBe(s.stored().nextRunAt);
  } finally {
    scheduler.stop();
  }
});

test('run now during retry backoff clears retryNotBefore and fires immediately before tickMs', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-09-24T10:00:00Z') });
  const s = await world();
  const now = Date.now();
  s.db
    .update(schedule)
    .set({ nextRunAt: now - 1_000, retryNotBefore: now + 300_000 })
    .where(eq(schedule.id, s.saved.id))
    .run();
  const clock = new FakeClock(now);
  const scheduler = createScheduler(s.svc, { tickMs: 60_000, clock });
  scheduler.start();
  try {
    await clock.advance(0);
    expect((await s.run()).status).toBe(200);
    await clock.advance(100);
    expect(s.steps()).toHaveLength(2);
    expect(s.stored().retryNotBefore).toBeNull();
  } finally {
    scheduler.stop();
  }
});

test('transient schedule failure advances due_event to retryNotBefore immediately and retries before tickMs', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-09-24T10:00:00Z') });
  const s = await world();
  const clock = new FakeClock(Date.now());
  const scheduler = createScheduler(s.svc, { tickMs: 600_000, clock });
  scheduler.start();
  try {
    await clock.advance(0);
    s.db
      .update(schedule)
      .set({ nextRunAt: clock.now() - 1_000 })
      .where(eq(schedule.id, s.saved.id))
      .run();
    const failedAt = clock.now();
    recordScheduleFailure(s.svc, s.saved.id, 'connection reset', failedAt);
    const retryAt = failedAt + 5 * 60_000;
    const synced = s.db
      .select()
      .from(dueEvent)
      .where(eq(dueEvent.id, `schedule:${s.saved.id}`))
      .get();
    expect(synced?.dueAt).toBe(retryAt);

    await clock.advance(5 * 60_000 - 1);
    expect(s.steps()).toHaveLength(1);
    await clock.advance(1);
    expect(s.steps()).toHaveLength(2);
  } finally {
    scheduler.stop();
  }
});

test('updateSchedule moving deadline to now fires before tickMs while daily prompt-only update preserves retry backoff', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-09-24T10:00:00Z') });
  const s = await world();
  const clock = new FakeClock(Date.now());
  const dailyAt = Date.parse('2026-09-24T09:00:00Z');
  const dailyRes = updateSchedule(s.svc, s.saved.id, {
    teamId: s.team.id,
    todoId: s.todoId,
    projectId: s.projectId,
    kind: 'daily',
    at: dailyAt,
    prompt: 'Daily original',
    tz: 'UTC',
    enabled: true,
  });
  expect(dailyRes?.record.cron).toBe('0 9 * * *');
  const retryAt = clock.now() + 300_000;
  s.db.update(schedule).set({ retryNotBefore: retryAt }).where(eq(schedule.id, s.saved.id)).run();
  const scheduler = createScheduler(s.svc, { tickMs: 7_200_000, clock });
  scheduler.start();
  try {
    await clock.advance(0);

    const promptOnly = updateSchedule(s.svc, s.saved.id, {
      teamId: s.team.id,
      todoId: s.todoId,
      projectId: s.projectId,
      kind: 'daily',
      at: dailyAt,
      prompt: 'Prompt edit only',
      tz: 'UTC',
      enabled: true,
    });
    expect(promptOnly?.record.prompt).toBe('Prompt edit only');
    expect(s.stored().retryNotBefore).toBe(retryAt);

    const resched = updateSchedule(
      s.svc,
      s.saved.id,
      {
        teamId: s.team.id,
        todoId: s.todoId,
        projectId: s.projectId,
        kind: 'once',
        at: clock.now(),
        prompt: 'Run now via edit',
        tz: 'UTC',
        enabled: true,
      },
      { allowAnyMinute: true },
    );
    expect(resched?.record.nextRunAt).toBe(clock.now());
    expect(s.stored().retryNotBefore).toBeNull();
    await clock.advance(100);
    expect(s.steps()).toHaveLength(2);
  } finally {
    scheduler.stop();
  }
});

test('run now fires immediately even while another due_event async handler is in flight', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-09-24T10:00:00Z') });
  const s = await world();
  const clock = new FakeClock(Date.now());
  let releasePoll: () => void = () => undefined;
  const pollBlocker = new Promise<void>((resolve) => {
    releasePoll = resolve;
  });
  vi.spyOn(ciLoop, 'createCiPoller').mockReturnValue({
    sweep: () => pollBlocker,
  });
  const scheduler = createScheduler(s.svc, { tickMs: 600_000, clock }, undefined, {
    githubFetch: s.svc.githubFetch,
    logger: { info: () => undefined },
  });
  s.db
    .insert(dueEvent)
    .values({
      id: 'poll:ci',
      kind: 'ci',
      dueAt: clock.now(),
      intervalMs: 600_000,
      attempts: 0,
      lastError: null,
    })
    .run();
  scheduler.start();
  try {
    const firstTick = clock.advance(0);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect((await s.run()).status).toBe(200);
    await clock.advance(100);
    expect(s.steps()).toHaveLength(2);

    releasePoll();
    await firstTick;
  } finally {
    scheduler.stop();
  }
});
