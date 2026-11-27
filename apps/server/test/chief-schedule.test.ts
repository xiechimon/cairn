import { chiefMemoryThreadId, scheduleRecordSchema } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  chief,
  chiefMessage,
  chiefThread,
  project as projectTable,
  schedule,
  step,
  team,
} from '../src/db/schema.js';
import { coordinatorThreadRow, ensureChief } from '../src/services/chief.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { finishCoordinatorTurn } from '../src/services/coordinator-steps.js';
import type { DueClock } from '../src/services/due-events.js';
import { executeMcpTool } from '../src/services/mcp-face.js';
import { runScheduleNow } from '../src/services/schedule-run.js';
import { fireScheduleWebhook } from '../src/services/schedule-webhook.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createSchedule, serverTimezone } from '../src/services/schedules.js';
import {
  bootServer,
  insertMachine,
  postProject,
  req,
  seedRoute,
  type TestServer,
} from './helpers.js';

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
      vi.setSystemTime(this.time);
      await next.cb();
    }
    this.time = target;
    vi.setSystemTime(this.time);
  }
}

const disposables: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
  vi.useRealTimers();
});

function setupWorld(startTime = Date.UTC(2026, 10, 1, 0, 50, 0)) {
  vi.useFakeTimers({ toFake: ['Date'], now: startTime });
  const s = bootServer();
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
  };
  const clock = new FakeClock(startTime);
  const scheduler = createScheduler(s.svc, { tickMs: 60_000, clock });
  disposables.push(() => {
    scheduler.stop();
    s.dispose();
  });
  insertMachine(s, { name: 'mac-runner' });
  seedRoute(s, 'coordinator', { provider: 'p', modelId: 'm' });
  const chiefRow = ensureChief(s.svc, s.team.id);
  const threadRow = coordinatorThreadRow(s.svc, chiefRow);
  const ctx = {
    teamId: s.team.id,
    userId: s.user.id,
    chiefId: chiefRow.id,
    chiefAgentId: 'agent-coord',
    threadId: threadRow.id,
    conversationId: threadRow.id,
  };
  return { s, deps, clock, scheduler, chiefRow, threadRow, ctx };
}

function addOtherTeam(s: TestServer) {
  s.db.insert(team).values({ id: 'team-other', name: 'Other', createdAt: 1 }).run();
  s.db
    .insert(chief)
    .values({ id: 'chief-other', userId: s.user.id, teamId: 'team-other', createdAt: 1 })
    .run();
  s.db
    .insert(chiefThread)
    .values({
      id: 'chief-thread-other',
      chiefId: 'chief-other',
      userId: s.user.id,
      teamId: 'team-other',
      title: 'Other Thread',
      createdAt: 1,
      updatedAt: 1,
      sessionId: '',
      sessionOpenedAt: 1,
    })
    .run();
  s.db
    .insert(projectTable)
    .values({ id: 'proj-other', teamId: 'team-other', name: 'Other Proj' })
    .run();
}

describe('Coordinator-thread scheduling', () => {
  test('schedule_todo omits todoId to schedule the current thread using chief tz, rejects missing prompt, and supports unschedule_todo by scheduleId', async () => {
    const { s, deps, chiefRow, threadRow, ctx } = setupWorld();
    s.db.update(chief).set({ tz: 'Asia/Tokyo' }).where(eq(chief.id, chiefRow.id)).run();

    await expect(
      executeChiefTool(deps, ctx, 'schedule_todo', {
        kind: 'daily',
        at: Date.UTC(2026, 10, 1, 0, 0, 0),
        prompt: '   ',
      }),
    ).rejects.toMatchObject({ status: 400 });

    const createdJson = await executeChiefTool(deps, ctx, 'schedule_todo', {
      kind: 'daily',
      at: Date.UTC(2026, 10, 1, 0, 0, 0),
      prompt: '每天早上 9 点帮我总结竞品新功能',
    });
    const created = scheduleRecordSchema.parse(JSON.parse(createdJson));
    expect(created).toMatchObject({
      teamId: s.team.id,
      todoId: null,
      chiefThreadId: threadRow.id,
      projectId: null,
      tz: 'Asia/Tokyo',
      prompt: '每天早上 9 点帮我总结竞品新功能',
      todo: null,
      thread: { id: threadRow.id, title: 'Coordinator', projectName: '' },
    });

    const explicitTzJson = await executeChiefTool(deps, ctx, 'schedule_todo', {
      kind: 'daily',
      at: Date.UTC(2026, 10, 1, 1, 0, 0),
      tz: 'UTC',
      prompt: 'Weekly follow-up',
    });
    const explicit = scheduleRecordSchema.parse(JSON.parse(explicitTzJson));
    expect(explicit.tz).toBe('UTC');

    addOtherTeam(s);
    const otherSchedule = createSchedule(s.svc, {
      teamId: 'team-other',
      chiefThreadId: 'chief-thread-other',
      kind: 'daily',
      at: Date.UTC(2026, 10, 1, 1, 0, 0),
      tz: serverTimezone(),
      prompt: 'Secret',
      createdBy: s.user.id,
    });
    await expect(
      executeChiefTool(deps, ctx, 'unschedule_todo', { scheduleId: otherSchedule.id }),
    ).rejects.toMatchObject({ status: 404 });

    const removed = JSON.parse(
      await executeChiefTool(deps, ctx, 'unschedule_todo', { scheduleId: created.id }),
    ) as { removed: number };
    expect(removed.removed).toBe(1);
    const listRes = await req(s.app, 'GET', '/api/schedules');
    const listed = ((await listRes.json()) as Array<{ id: string }>).map((r) => r.id);
    expect(listed).toEqual([explicit.id]);
  });

  test('mcp-face enforces exact XOR targets and cross-team isolation', async () => {
    const { s, deps, threadRow } = setupWorld();
    addOtherTeam(s);
    const mcpCtx = { teamId: s.team.id, user: s.user, grants: new Set(['*']) };

    await expect(
      executeMcpTool(deps, mcpCtx, 'schedule_todo', {
        kind: 'daily',
        at: Date.UTC(2026, 10, 1, 1, 0, 0),
        prompt: 'No target',
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      executeMcpTool(deps, mcpCtx, 'schedule_todo', {
        todoId: 'todo-1',
        chiefThreadId: threadRow.id,
        kind: 'daily',
        at: Date.UTC(2026, 10, 1, 1, 0, 0),
        prompt: 'Both targets',
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      executeMcpTool(deps, mcpCtx, 'schedule_todo', {
        chiefThreadId: 'chief-thread-other',
        kind: 'daily',
        at: Date.UTC(2026, 10, 1, 1, 0, 0),
        prompt: 'Cross-team thread',
      }),
    ).rejects.toMatchObject({ status: 404 });

    const created = scheduleRecordSchema.parse(
      JSON.parse(
        await executeMcpTool(deps, mcpCtx, 'schedule_todo', {
          chiefThreadId: threadRow.id,
          kind: 'daily',
          at: Date.UTC(2026, 10, 1, 1, 0, 0),
          prompt: 'MCP thread schedule',
        }),
      ),
    );
    expect(created.chiefThreadId).toBe(threadRow.id);

    await expect(executeMcpTool(deps, mcpCtx, 'unschedule_todo', {})).rejects.toMatchObject({
      status: 400,
    });
    const unsched = JSON.parse(
      await executeMcpTool(deps, mcpCtx, 'unschedule_todo', { scheduleId: created.id }),
    ) as { removed: number };
    expect(unsched.removed).toBe(1);
  });

  test('end-to-end Coordinator create -> controlled-clock Run-now & due firing -> finishCoordinatorTurn -> superseded guard', async () => {
    const start = Date.UTC(2026, 10, 1, 0, 50, 0);
    const { s, deps, clock, scheduler, threadRow, ctx } = setupWorld(start);
    scheduler.start();

    const created = scheduleRecordSchema.parse(
      JSON.parse(
        await executeChiefTool(deps, ctx, 'schedule_todo', {
          kind: 'daily',
          at: Date.UTC(2026, 10, 1, 1, 0, 0),
          tz: 'Asia/Shanghai',
          prompt: '每天早上 9 点帮我总结竞品新功能',
        }),
      ),
    );
    expect(created.nextRunAt).toBe(Date.UTC(2026, 10, 1, 1, 0, 0));

    runScheduleNow(s.svc, s.team.id, created.id);
    await clock.advance(0);

    const runNowSteps = s.db
      .select()
      .from(step)
      .where(and(eq(step.buildId, threadRow.id), eq(step.kind, 'chief')))
      .all();
    expect(runNowSteps).toHaveLength(1);
    const step1 = runNowSteps[0]!;
    expect(step1.scheduleId).toBe(created.id);
    expect(step1.scheduledBy).toBe(s.user.id);
    expect(step1.prompt).toContain('每天早上 9 点帮我总结竞品新功能');
    const msgsAfterRunNow = s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, threadRow.id))
      .all();
    expect(msgsAfterRunNow.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: 'user', content: '每天早上 9 点帮我总结竞品新功能' },
    ]);

    expect(() => runScheduleNow(s.svc, s.team.id, created.id)).toThrow(/already running/);

    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: clock.now() })
      .where(eq(step.id, step1.id))
      .run();
    finishCoordinatorTurn(deps, s.db.select().from(step).where(eq(step.id, step1.id)).get()!, {
      status: 'success',
    });

    const afterRun1 = s.db.select().from(schedule).where(eq(schedule.id, created.id)).get()!;
    expect(afterRun1.lastRunStatus).toBe('completed');
    expect(afterRun1.nextRunAt).toBe(Date.UTC(2026, 10, 1, 1, 0, 0));

    await clock.advance(10 * 60_000);
    const stepsAfterDue = s.db
      .select()
      .from(step)
      .where(and(eq(step.buildId, threadRow.id), eq(step.kind, 'chief')))
      .all();
    expect(stepsAfterDue).toHaveLength(2);
    const step2 = stepsAfterDue[1]!;
    expect(step2.id).not.toBe(step1.id);
    const afterDue = s.db.select().from(schedule).where(eq(schedule.id, created.id)).get()!;
    expect(afterDue.lastRunStepId).toBe(step2.id);
    expect(afterDue.nextRunAt).toBe(Date.UTC(2026, 10, 2, 1, 0, 0));

    finishCoordinatorTurn(deps, step1, { status: 'failed', errorMessage: 'late stale failure' });
    const guardedRow = s.db.select().from(schedule).where(eq(schedule.id, created.id)).get()!;
    expect(guardedRow.lastRunStepId).toBe(step2.id);
    expect(guardedRow.lastRunStatus).toBe('started');
    expect(guardedRow.enabled).toBe(true);

    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: clock.now() })
      .where(eq(step.id, step2.id))
      .run();
    finishCoordinatorTurn(deps, s.db.select().from(step).where(eq(step.id, step2.id)).get()!, {
      status: 'stopped',
    });
    expect(
      s.db.select().from(schedule).where(eq(schedule.id, created.id)).get()?.lastRunStatus,
    ).toBe('stopped');
  });

  test('once transient failure re-arms nextRunAt for retry while permanent failure pauses schedule', async () => {
    const start = Date.UTC(2026, 10, 1, 0, 0, 0);
    const { s, deps, clock, scheduler, threadRow } = setupWorld(start);
    scheduler.start();

    const once = createSchedule(
      s.svc,
      {
        teamId: s.team.id,
        chiefThreadId: threadRow.id,
        kind: 'once',
        at: start + 60_000,
        tz: 'UTC',
        prompt: 'One-shot check',
        createdBy: s.user.id,
      },
      { allowAnyMinute: true },
    );

    await clock.advance(60_000);
    const firstStep = s.db
      .select()
      .from(step)
      .where(and(eq(step.buildId, threadRow.id), eq(step.kind, 'chief')))
      .get()!;
    expect(firstStep.scheduleId).toBe(once.id);

    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: clock.now() })
      .where(eq(step.id, firstStep.id))
      .run();
    finishCoordinatorTurn(deps, s.db.select().from(step).where(eq(step.id, firstStep.id)).get()!, {
      status: 'failed',
      errorMessage: 'ECONNRESET connection reset by peer',
    });

    const transientRow = s.db.select().from(schedule).where(eq(schedule.id, once.id)).get()!;
    expect(transientRow.enabled).toBe(true);
    expect(transientRow.lastRunStatus).toBe('failed');
    expect(transientRow.retryNotBefore).not.toBeNull();
    expect(transientRow.nextRunAt).toBe(transientRow.retryNotBefore);

    await clock.advance(5 * 60_000);
    const stepsAfterRetry = s.db
      .select()
      .from(step)
      .where(and(eq(step.buildId, threadRow.id), eq(step.kind, 'chief')))
      .all();
    expect(stepsAfterRetry).toHaveLength(2);
    const secondStep = stepsAfterRetry[1]!;

    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: clock.now() })
      .where(eq(step.id, secondStep.id))
      .run();
    finishCoordinatorTurn(deps, s.db.select().from(step).where(eq(step.id, secondStep.id)).get()!, {
      status: 'failed',
      errorMessage: 'invalid request syntax',
    });

    const permanentRow = s.db.select().from(schedule).where(eq(schedule.id, once.id)).get()!;
    expect(permanentRow.enabled).toBe(false);
    expect(permanentRow.pausedReason).toContain('invalid request syntax');
  });

  test('daily transient failure retries in 5 min instead of next day, side threads & event target rejected, and server stop settles schedule', async () => {
    const start = Date.UTC(2026, 10, 1, 0, 55, 0);
    const { s, deps, clock, scheduler, chiefRow, threadRow } = setupWorld(start);
    scheduler.start();

    expect(() =>
      createSchedule(s.svc, {
        teamId: s.team.id,
        chiefThreadId: threadRow.id,
        kind: 'event',
        triggerSpec: { topic: 'todo.build.completed' },
        tz: 'UTC',
        prompt: 'Bad event',
        createdBy: s.user.id,
      }),
    ).toThrow(/event/);

    const sideId = chiefMemoryThreadId(chiefRow.id);
    s.db
      .insert(chiefThread)
      .values({
        id: sideId,
        chiefId: chiefRow.id,
        userId: s.user.id,
        teamId: s.team.id,
        title: 'Memory',
        createdAt: 1,
        updatedAt: 1,
        sessionId: '',
        sessionOpenedAt: 1,
      })
      .run();
    expect(() =>
      createSchedule(s.svc, {
        teamId: s.team.id,
        chiefThreadId: sideId,
        kind: 'daily',
        at: start + 300_000,
        tz: 'UTC',
        prompt: 'Should fail',
        createdBy: s.user.id,
      }),
    ).toThrow(/not found/);

    const daily = createSchedule(s.svc, {
      teamId: s.team.id,
      chiefThreadId: threadRow.id,
      kind: 'daily',
      at: Date.UTC(2026, 10, 1, 1, 0, 0),
      tz: 'UTC',
      prompt: 'Daily check',
      createdBy: s.user.id,
    });
    await clock.advance(5 * 60_000);
    const step1 = s.db
      .select()
      .from(step)
      .where(and(eq(step.buildId, threadRow.id), eq(step.kind, 'chief')))
      .get()!;
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: clock.now() })
      .where(eq(step.id, step1.id))
      .run();
    finishCoordinatorTurn(deps, s.db.select().from(step).where(eq(step.id, step1.id)).get()!, {
      status: 'failed',
      errorMessage: 'ECONNRESET connection reset',
    });
    const retryRow = s.db.select().from(schedule).where(eq(schedule.id, daily.id)).get()!;
    expect(retryRow.nextRunAt).toBe(retryRow.retryNotBefore);
    await clock.advance(5 * 60_000);
    const stepsAfterRetry = s.db
      .select()
      .from(step)
      .where(and(eq(step.buildId, threadRow.id), eq(step.kind, 'chief')))
      .all();
    expect(stepsAfterRetry).toHaveLength(2);
  });

  test('concurrency, busy once/webhook preservation, webhook dedupe/ignore, and archived/deleted thread handling', async () => {
    const start = Date.UTC(2026, 10, 1, 0, 0, 0);
    const { s, clock, scheduler, threadRow, chiefRow } = setupWorld(start);
    const projId = await postProject(s.app, 'Conc Project');
    const dueAt = start + 60_000;

    const first = createSchedule(
      s.svc,
      {
        teamId: s.team.id,
        chiefThreadId: threadRow.id,
        kind: 'daily',
        at: dueAt,
        tz: 'UTC',
        prompt: 'First concurrent prompt',
        createdBy: s.user.id,
      },
      { allowAnyMinute: true },
    );
    const second = createSchedule(
      s.svc,
      {
        teamId: s.team.id,
        chiefThreadId: threadRow.id,
        kind: 'daily',
        at: dueAt,
        tz: 'UTC',
        prompt: 'Second concurrent prompt',
        createdBy: s.user.id,
      },
      { allowAnyMinute: true },
    );

    await clock.advance(60_000);
    await scheduler.tick(clock.now());
    const steps = s.db
      .select()
      .from(step)
      .where(and(eq(step.buildId, threadRow.id), eq(step.kind, 'chief')))
      .all();
    expect(steps).toHaveLength(1);
    const row1 = s.db.select().from(schedule).where(eq(schedule.id, first.id)).get()!;
    const row2 = s.db.select().from(schedule).where(eq(schedule.id, second.id)).get()!;
    expect(row1.lastRunStepId ?? row2.lastRunStepId).toBe(steps[0]!.id);
    expect(row1.nextRunAt).toBeGreaterThan(dueAt);
    expect(row2.nextRunAt).toBeGreaterThan(dueAt);

    const hookToken = 'wh-secret-token-for-thread-test-1234';
    const hooked = createSchedule(
      s.svc,
      {
        teamId: s.team.id,
        chiefThreadId: threadRow.id,
        kind: 'webhook',
        tz: 'UTC',
        prompt: 'Webhook thread turn',
        createdBy: s.user.id,
      },
      { webhookToken: hookToken },
    );
    expect(fireScheduleWebhook({ db: s.db, hub: s.hub }, hookToken, 'deliv-1')).toEqual({
      result: 'fired',
      deliveryId: 'deliv-1',
    });
    expect(fireScheduleWebhook({ db: s.db, hub: s.hub }, hookToken, 'deliv-1')).toEqual({
      result: 'duplicate',
      deliveryId: 'deliv-1',
    });

    await scheduler.tick(clock.now());
    const busyHook = s.db.select().from(schedule).where(eq(schedule.id, hooked.id)).get()!;
    expect(busyHook.lastRunStepId).toBeNull();
    expect(busyHook.nextRunAt).not.toBeNull();

    await clock.advance(13 * 60 * 60_000);
    await scheduler.tick(clock.now());
    expect(
      s.db.select().from(schedule).where(eq(schedule.id, hooked.id)).get()?.nextRunAt,
    ).not.toBeNull();

    s.db
      .update(step)
      .set({ status: 'done', finishedAt: clock.now() })
      .where(eq(step.id, steps[0]!.id))
      .run();
    await scheduler.tick(clock.now());
    const firedHook = s.db.select().from(schedule).where(eq(schedule.id, hooked.id)).get()!;
    expect(firedHook.lastRunStepId).not.toBeNull();
    expect(firedHook.nextRunAt).toBeNull();

    s.db
      .update(chiefThread)
      .set({ archivedAt: clock.now() })
      .where(eq(chiefThread.id, threadRow.id))
      .run();
    expect(fireScheduleWebhook({ db: s.db, hub: s.hub }, hookToken, 'deliv-2')).toEqual({
      result: 'ignored',
      deliveryId: 'deliv-2',
    });
    s.db.update(schedule).set({ nextRunAt: clock.now() }).where(eq(schedule.id, first.id)).run();
    await scheduler.tick(clock.now());
    const archivedSched = s.db.select().from(schedule).where(eq(schedule.id, first.id)).get()!;
    expect(archivedSched.enabled).toBe(false);
    expect(archivedSched.pausedReason).toBe('Thread archived');

    s.db
      .insert(chiefThread)
      .values({
        id: 'chief-thread-del',
        chiefId: chiefRow.id,
        userId: s.user.id,
        teamId: s.team.id,
        projectId: projId,
        title: 'Temp',
        createdAt: 1,
        updatedAt: 1,
        sessionId: '',
        sessionOpenedAt: 1,
      })
      .run();
    const doomed = createSchedule(s.svc, {
      teamId: s.team.id,
      chiefThreadId: 'chief-thread-del',
      kind: 'daily',
      at: dueAt,
      tz: 'UTC',
      prompt: 'Orphan',
      createdBy: s.user.id,
    });
    s.db.delete(chiefThread).where(eq(chiefThread.id, 'chief-thread-del')).run();
    s.db.update(schedule).set({ nextRunAt: clock.now() }).where(eq(schedule.id, doomed.id)).run();
    await scheduler.tick(clock.now());
    expect(s.db.select().from(schedule).where(eq(schedule.id, doomed.id)).get()).toBeUndefined();
  });
});
