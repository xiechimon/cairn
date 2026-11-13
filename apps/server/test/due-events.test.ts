import { scheduleRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { chief, dueEvent, schedule as scheduleTable } from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import {
  createDueRunner,
  type DueClock,
  DueDeliveryCrash,
  dueBackoffMs,
} from '../src/services/due-events.js';
import { createScheduler } from '../src/services/scheduler.js';
import {
  bootServer,
  insertMachine,
  postProject,
  req,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

class FakeClock implements DueClock {
  time: number;
  delays: number[] = [];
  private queue: Array<{ at: number; cb: () => void | Promise<void> }> = [];

  constructor(time: number) {
    this.time = time;
  }

  now(): number {
    return this.time;
  }

  setTimer(callback: () => void | Promise<void>, delayMs: number): unknown {
    this.delays.push(delayMs);
    const timer = { at: this.time + delayMs, cb: callback };
    this.queue.push(timer);
    return timer;
  }

  clearTimer(handle: unknown): void {
    this.queue = this.queue.filter((timer) => timer !== handle);
  }

  armedDelay(): number | null {
    const next = [...this.queue].sort((left, right) => left.at - right.at)[0];
    return next ? next.at - this.time : null;
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

  async fireReady(): Promise<void> {
    const ready = this.queue.filter((timer) => timer.at <= this.time);
    this.queue = this.queue.filter((timer) => timer.at > this.time);
    for (const timer of ready) await timer.cb();
  }
}

const servers: TestServer[] = [];
function boot() {
  const server = bootServer();
  insertMachine(server);
  servers.push(server);
  return server;
}
afterEach(() => {
  while (servers.length > 0) servers.pop()?.dispose();
});

describe('due events (#2502)', () => {
  test('an event due at T fires within 1s of T and an earlier insert re-arms the timer', async () => {
    const server = boot();
    const clock = new FakeClock(0);
    const fired: string[] = [];
    const runner = createDueRunner(server.db, clock, {
      schedule: (event) => {
        fired.push(event.id);
      },
    });
    runner.upsert({ id: 'schedule:late', kind: 'schedule', dueAt: 15_000 });
    runner.arm();
    expect(clock.armedDelay()).toBe(15_000);
    runner.upsert({ id: 'schedule:early', kind: 'schedule', dueAt: 1_000 });
    expect(clock.armedDelay()).toBe(1_000);
    await clock.advance(999);
    expect(fired).toEqual([]);
    await clock.advance(1);
    expect(fired).toEqual(['schedule:early']);
    expect(clock.time - 1_000).toBeLessThanOrEqual(1_000);
  });

  test('an empty due table invokes no handler across a simulated hour', async () => {
    const server = boot();
    const clock = new FakeClock(0);
    let calls = 0;
    const runner = createDueRunner(server.db, clock, {
      sweep: () => {
        calls += 1;
      },
    });
    runner.arm();
    await clock.advance(3_600_000);
    expect(calls).toBe(0);
    expect(clock.armedDelay()).toBeNull();
  });

  test('a crash after the handler runs and before re-arm keeps the event for the next start', async () => {
    const server = boot();
    const clock = new FakeClock(0);
    const calls: string[] = [];
    const effects = new Set<string>();
    const handlers = {
      sweep: (event: { id: string }) => {
        calls.push(event.id);
        if (!effects.has(event.id)) effects.add(event.id);
        throw new DueDeliveryCrash();
      },
    };
    const first = createDueRunner(server.db, clock, handlers);
    first.upsert({ id: 'sweep:main', kind: 'sweep', dueAt: 0 });
    first.arm();
    await clock.advance(0);
    expect(calls).toEqual(['sweep:main']);
    expect(
      server.db.select().from(dueEvent).where(eq(dueEvent.id, 'sweep:main')).get()?.dueAt,
    ).toBe(0);
    first.stop();
    const restarted = createDueRunner(server.db, clock, {
      sweep: (event) => {
        calls.push(event.id);
        if (!effects.has(event.id)) effects.add(event.id);
      },
    });
    restarted.arm();
    await clock.advance(0);
    expect(calls).toEqual(['sweep:main', 'sweep:main']);
    expect(effects.size).toBe(1);
    restarted.stop();
  });

  test('a slow handler does not block another due row or the next arm', async () => {
    const server = boot();
    const clock = new FakeClock(0);
    let release: () => void = () => undefined;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: string[] = [];
    const runner = createDueRunner(server.db, clock, {
      slow: () =>
        blocker.then(() => {
          seen.push('slow');
        }),
      fast: () => {
        seen.push('fast');
      },
    });
    runner.upsert({ id: 'a-slow', kind: 'slow', dueAt: 0, intervalMs: 5_000 });
    runner.upsert({ id: 'b-fast', kind: 'fast', dueAt: 0 });
    const delivery = clock.advance(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual(['fast']);
    expect(clock.armedDelay()).toBe(5_000);
    release();
    await delivery;
    expect(seen).toEqual(['fast', 'slow']);
    runner.stop();
  });

  test('stop during a running handler does not re-arm when the handler finishes', async () => {
    const server = boot();
    const clock = new FakeClock(0);
    let release: () => void = () => undefined;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = createDueRunner(server.db, clock, {
      slow: () => blocker,
    });
    runner.upsert({ id: 'a-slow', kind: 'slow', dueAt: 0, intervalMs: 5_000 });
    const delivery = clock.advance(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(clock.armedDelay()).toBe(5_000);
    const before = clock.delays.length;
    runner.stop();
    expect(clock.armedDelay()).toBeNull();
    release();
    await delivery;
    expect(clock.delays.length).toBe(before);
    expect(clock.armedDelay()).toBeNull();
  });

  test('an arm during an active delivery still re-arms after the row moves forward', async () => {
    const server = boot();
    const clock = new FakeClock(0);
    let release: (value: { rescheduleAt: number }) => void = () => undefined;
    const blocker = new Promise<{ rescheduleAt: number }>((resolve) => {
      release = resolve;
    });
    const runner = createDueRunner(server.db, clock, {
      schedule: () => blocker,
    });
    runner.upsert({ id: 'schedule:one', kind: 'schedule', dueAt: 0 });
    const delivery = clock.advance(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const delaysBefore = clock.delays.length;
    runner.arm();
    await clock.fireReady();
    expect(clock.delays.slice(delaysBefore).every((delay) => delay > 0)).toBe(true);
    release({ rescheduleAt: 10_000 });
    await delivery;
    expect(clock.armedDelay()).toBe(10_000);
    runner.stop();
  });

  test('a failed handler records the error and retries after backoff', async () => {
    const server = boot();
    const clock = new FakeClock(0);
    let calls = 0;
    const runner = createDueRunner(server.db, clock, {
      poll: () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
      },
    });
    runner.upsert({ id: 'poll:ci', kind: 'poll', dueAt: 0 });
    runner.arm();
    await clock.advance(0);
    const failed = server.db.select().from(dueEvent).where(eq(dueEvent.id, 'poll:ci')).get();
    expect(failed?.attempts).toBe(1);
    expect(failed?.lastError).toBe('boom');
    expect(failed?.dueAt).toBe(dueBackoffMs(1));
    await clock.advance(dueBackoffMs(1) - 1);
    expect(calls).toBe(1);
    await clock.advance(1);
    expect(calls).toBe(2);
    expect(
      server.db.select().from(dueEvent).where(eq(dueEvent.id, 'poll:ci')).get(),
    ).toBeUndefined();
    runner.stop();
  });

  test('a once schedule due at T fires from the single timer within 1s of T', async () => {
    const server = boot();
    const projectId = await postProject(server.app, 'due-schedule');
    const created = (await (
      await req(server.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: 'due once',
        spec: 'run',
      })
    ).json()) as { id: string };
    const at = new Date('2026-09-24T14:30:00+08:00').getTime();
    const record = scheduleRecordSchema.parse(
      await (
        await req(server.app, 'POST', '/api/schedules', {
          todoId: created.id,
          kind: 'once',
          at,
          tz: 'Asia/Shanghai',
        })
      ).json(),
    );
    const clock = new FakeClock(at - 10_000);
    const scheduler = createScheduler(server.svc, { tickMs: 15_000, clock });
    scheduler.start();
    await clock.advance(0);
    await clock.advance(9_000);
    expect(
      (await (
        await req(server.app, 'GET', `/api/projects/${projectId}/builds`)
      ).json()) as unknown[],
    ).toHaveLength(0);
    await clock.advance(1_000);
    const builds = (await (
      await req(server.app, 'GET', `/api/projects/${projectId}/builds`)
    ).json()) as unknown[];
    expect(builds).toHaveLength(1);
    expect(clock.time - (record.nextRunAt as number)).toBeLessThanOrEqual(1_000);
    scheduler.stop();
  });

  test('a future retryNotBefore is not replaced by the older nextRunAt', async () => {
    const server = boot();
    const projectId = await postProject(server.app, 'retry-schedule');
    const created = (await (
      await req(server.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: 'retry once',
        spec: 'run',
      })
    ).json()) as { id: string };
    const at = new Date('2026-09-24T14:30:00+08:00').getTime();
    const record = scheduleRecordSchema.parse(
      await (
        await req(server.app, 'POST', '/api/schedules', {
          todoId: created.id,
          kind: 'once',
          at,
          tz: 'Asia/Shanghai',
        })
      ).json(),
    );
    const retryAt = at + 5 * 60_000;
    server.db
      .update(scheduleTable)
      .set({ nextRunAt: at, retryNotBefore: retryAt })
      .where(eq(scheduleTable.id, record.id))
      .run();
    const clock = new FakeClock(at);
    const scheduler = createScheduler(server.svc, { tickMs: 15_000, clock });
    scheduler.start();
    const event = server.db
      .select()
      .from(dueEvent)
      .where(eq(dueEvent.id, `schedule:${record.id}`))
      .get();
    expect(event?.dueAt).toBe(retryAt);
    await clock.advance(1_000);
    expect(
      (await (
        await req(server.app, 'GET', `/api/projects/${projectId}/builds`)
      ).json()) as unknown[],
    ).toHaveLength(0);
    expect(
      server.db
        .select()
        .from(dueEvent)
        .where(eq(dueEvent.id, `schedule:${record.id}`))
        .get()?.dueAt,
    ).toBe(retryAt);
    scheduler.stop();
  });

  test('a once schedule waits out an active step instead of arming immediately again', async () => {
    const server = boot();
    seedSessionRoute(server);
    const projectId = await postProject(server.app, 'busy-schedule');
    const created = (await (
      await req(server.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: 'busy once',
        spec: 'run',
      })
    ).json()) as { id: string };
    const started = (await (
      await req(server.app, 'POST', `/api/projects/${projectId}/builds`, {
        todoIds: [created.id],
        withPlan: false,
      })
    ).json()) as { builds: unknown[] };
    expect(started.builds).toHaveLength(1);
    const at = new Date('2026-09-24T14:30:00+08:00').getTime();
    const record = scheduleRecordSchema.parse(
      await (
        await req(server.app, 'POST', '/api/schedules', {
          todoId: created.id,
          kind: 'once',
          at,
          tz: 'Asia/Shanghai',
        })
      ).json(),
    );
    const clock = new FakeClock(at);
    const scheduler = createScheduler(server.svc, { tickMs: 15_000, clock });
    scheduler.start();
    await clock.advance(0);
    const event = server.db
      .select()
      .from(dueEvent)
      .where(eq(dueEvent.id, `schedule:${record.id}`))
      .get();
    expect(event?.dueAt).toBe(at + 15_000);
    const immediate = clock.delays.filter((delay) => delay === 0).length;
    await clock.advance(1_000);
    expect(clock.delays.filter((delay) => delay === 0).length).toBe(immediate);
    expect(
      server.db
        .select()
        .from(dueEvent)
        .where(eq(dueEvent.id, `schedule:${record.id}`))
        .get()?.dueAt,
    ).toBe(at + 15_000);
    scheduler.stop();
  });

  test('a failed chief wake keeps its backoff instead of the overdue wake time', async () => {
    const server = boot();
    const at = new Date('2026-09-24T14:30:00+08:00').getTime();
    server.db
      .insert(chief)
      .values({
        id: `chief-${server.user.id}-${server.team.id}`,
        userId: server.user.id,
        teamId: server.team.id,
        createdAt: at,
        wakes: [{ id: 'wake-1', at, threadId: 'missing-thread', note: 'check' }],
      })
      .run();
    const clock = new FakeClock(at);
    const scheduler = createScheduler(server.svc, { tickMs: 15_000, clock });
    scheduler.start();
    await clock.advance(0);
    const event = server.db.select().from(dueEvent).where(eq(dueEvent.id, 'wake:next')).get();
    expect(event?.attempts).toBe(1);
    expect(event?.dueAt).toBe(at + dueBackoffMs(1));
    const immediate = clock.delays.filter((delay) => delay === 0).length;
    await clock.advance(dueBackoffMs(1) - 1);
    expect(clock.delays.filter((delay) => delay === 0).length).toBe(immediate);
    expect(server.db.select().from(dueEvent).where(eq(dueEvent.id, 'wake:next')).get()?.dueAt).toBe(
      at + dueBackoffMs(1),
    );
    scheduler.stop();
  });

  test('an ownership handoff event is delivered by its kind and reschedules until its deadline', async () => {
    const server = boot();
    const stepId = newRecordId();
    const createdAt = 1_000;
    const seen: number[] = [];
    server.db
      .insert(dueEvent)
      .values({
        id: `ownership-handoff:${stepId}`,
        kind: 'ownership-handoff',
        dueAt: createdAt,
      })
      .run();
    const clock = new FakeClock(createdAt);
    const runner = createDueRunner(server.db, clock, {
      'ownership-handoff': (_event, now) => {
        seen.push(now);
        return now < createdAt + 30_000 ? { rescheduleAt: now + 15_000 } : undefined;
      },
    });
    runner.arm();
    await clock.advance(0);
    await clock.advance(15_000);
    await clock.advance(15_000);
    expect(seen).toEqual([createdAt, createdAt + 15_000, createdAt + 30_000]);
    expect(
      server.db
        .select()
        .from(dueEvent)
        .where(eq(dueEvent.id, `ownership-handoff:${stepId}`))
        .get(),
    ).toBeUndefined();
    runner.stop();
  });
});
