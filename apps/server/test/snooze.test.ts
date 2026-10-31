import {
  ASK_USER_QUESTION_KIND,
  SNOOZE_EVENT_ENDS_SNOOZE,
  SNOOZE_EVENTS,
  type SnoozeEvent,
  type TodoRecord,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import webpush from 'web-push';
import {
  build,
  message,
  notification,
  pushDigestItem,
  pushSubscription,
  schedule,
  step,
  todo,
} from '../src/db/schema.js';
import { sendBuildSteer } from '../src/services/builds.js';
import { upsertMessage } from '../src/services/machine-deps.js';
import { queuePushDigest, sweepPushDigest } from '../src/services/push.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createSchedule, finishScheduledStep } from '../src/services/schedules.js';
import {
  endSnoozeOn,
  snoozeTodo,
  sweepSnoozeExpiry,
  unsnoozeTodo,
} from '../src/services/snooze.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, postProject, req } from './helpers.js';

const SHANGHAI = 'Asia/Shanghai';
const at = (iso: string) => Date.parse(iso);

async function world() {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const created = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'Thread', spec: '' })
  ).json()) as { id: string };
  s.db
    .insert(build)
    .values({
      id: 'snooze-build',
      todoId: created.id,
      triggerSource: 'user',
      withPlan: false,
      createdAt: Date.now(),
    })
    .run();
  s.db
    .update(todo)
    .set({ phase: 'building', latestBuildId: 'snooze-build' })
    .where(eq(todo.id, created.id))
    .run();
  s.db
    .insert(pushSubscription)
    .values({
      id: 'snooze-sub',
      userId: s.user.id,
      teamId: s.team.id,
      endpoint: 'https://push.example/snooze',
      p256dh: 'key',
      auth: 'auth',
      createdAt: Date.now(),
    })
    .run();
  const send = vi
    .spyOn(webpush, 'sendNotification')
    .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  return { ...s, projectId, todoId: created.id, send };
}

type World = Awaited<ReturnType<typeof world>>;

const record = async (w: World): Promise<TodoRecord> =>
  (await (await req(w.app, 'GET', `/api/todos/${w.todoId}`)).json()) as TodoRecord;
const snooze = (w: World, body: unknown) =>
  req(w.app, 'POST', `/api/todos/${w.todoId}/snooze`, body);
const row = (w: World) => w.db.select().from(todo).where(eq(todo.id, w.todoId)).get();
const notificationRow = (w: World) =>
  w.db
    .select()
    .from(notification)
    .where(eq(notification.id, `${w.user.id}:${w.todoId}`))
    .get();

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('snooze and unsnooze API', () => {
  test('needed stores the mode without a timestamp and the record carries both fields', async () => {
    const w = await world();
    const res = await snooze(w, { until: 'needed' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ snoozeMode: 'needed', snoozedUntil: null });
    expect(row(w)).toMatchObject({ snoozeMode: 'needed', snoozedUntil: null });
    expect(await record(w)).toMatchObject({ snoozeMode: 'needed', snoozedUntil: null });
  });

  test('a snooze bumps the version and publishes the todo document', async () => {
    const w = await world();
    const before = (await record(w)).v;
    await snooze(w, { until: 'needed' });
    expect((await record(w)).v).toBe(before + 1);
  });

  test('unsnooze clears both fields and does not mark the thread unread', async () => {
    const w = await world();
    await snooze(w, { until: 'needed' });
    const res = await req(w.app, 'POST', `/api/todos/${w.todoId}/unsnooze`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ snoozeMode: null, snoozedUntil: null });
    expect(notificationRow(w)).toBeUndefined();
  });

  test('unsnooze on a thread that is not snoozed is a no-op', async () => {
    const w = await world();
    const before = (await record(w)).v;
    const res = await req(w.app, 'POST', `/api/todos/${w.todoId}/unsnooze`);
    expect(res.status).toBe(200);
    expect((await record(w)).v).toBe(before);
  });

  test('snoozing again replaces the previous snooze', async () => {
    const w = await world();
    await snooze(w, { until: 'needed' });
    const later = Date.now() + 3_600_000;
    await snooze(w, { until: later });
    expect(row(w)).toMatchObject({ snoozeMode: 'until', snoozedUntil: later });
  });

  test('unknown thread -> 404, archived thread -> 409, bad input -> 400', async () => {
    const w = await world();
    expect(
      (await req(w.app, 'POST', '/api/todos/missing/snooze', { until: 'needed' })).status,
    ).toBe(404);
    expect((await req(w.app, 'POST', '/api/todos/missing/unsnooze')).status).toBe(404);
    expect((await snooze(w, { until: 'soon' })).status).toBe(400);
    expect((await snooze(w, { until: Date.now() - 1000 })).status).toBe(400);
    expect((await snooze(w, { until: 'tomorrow', tz: 'Mars/Olympus' })).status).toBe(400);
    expect((await snooze(w, {})).status).toBe(400);
    await req(w.app, 'POST', `/api/todos/${w.todoId}/archive`);
    expect((await snooze(w, { until: 'needed' })).status).toBe(409);
    expect(row(w)).toMatchObject({ snoozeMode: null, snoozedUntil: null });
  });
});

describe('timed snooze through the API with a fake clock (tz Asia/Shanghai)', () => {
  test.each([
    ['23:30', '2026-11-02T23:30:00+08:00', '2026-11-03T08:00:00+08:00'],
    ['02:00', '2026-11-02T02:00:00+08:00', '2026-11-02T08:00:00+08:00'],
  ])('tomorrow at %s', async (_name, now, expected) => {
    const w = await world();
    vi.useFakeTimers({ toFake: ['Date'], now: at(now) });
    const res = await snooze(w, { until: 'tomorrow', tz: SHANGHAI });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ snoozeMode: 'until', snoozedUntil: at(expected) });
  });

  test('tomorrow 09:00, next Monday and an explicit timestamp', async () => {
    const w = await world();
    vi.useFakeTimers({ toFake: ['Date'], now: at('2026-11-04T10:00:00+08:00') });
    await snooze(w, { until: 'tomorrow-09:00', tz: SHANGHAI });
    expect(row(w)?.snoozedUntil).toBe(at('2026-11-05T09:00:00+08:00'));
    await snooze(w, { until: 'next-monday', tz: SHANGHAI });
    expect(row(w)?.snoozedUntil).toBe(at('2026-11-09T09:00:00+08:00'));
    await snooze(w, { until: '2026-11-10T18:45:00+08:00' });
    expect(row(w)?.snoozedUntil).toBe(at('2026-11-10T18:45:00+08:00'));
  });
});

describe('the thread returns when the clock passes snoozedUntil', () => {
  test('the scheduler tick clears the snooze and marks the thread unread', async () => {
    const w = await world();
    const until = at('2026-11-03T08:00:00+08:00');
    snoozeTodo(w.svc, w.todoId, { until }, until - 3_600_000);
    const scheduler = createScheduler(w.svc, { tickMs: 60_000 });

    await scheduler.tick(until - 1);
    expect(row(w)).toMatchObject({ snoozeMode: 'until', snoozedUntil: until });
    expect(notificationRow(w)).toBeUndefined();

    await scheduler.tick(until);
    expect(row(w)).toMatchObject({ snoozeMode: null, snoozedUntil: null });
    expect(notificationRow(w)).toMatchObject({ readAt: null, type: 'marked_unread' });
    const unread = (await (
      await req(w.app, 'GET', `/api/teams/${w.team.id}/notifications`)
    ).json()) as { unreadThreadIds: string[] };
    expect(unread.unreadThreadIds).toContain(w.todoId);
  });

  test('a read thread becomes unread again on expiry', async () => {
    const w = await world();
    await req(w.app, 'POST', `/api/teams/${w.team.id}/notifications/${w.todoId}/unread`);
    await req(w.app, 'POST', `/api/teams/${w.team.id}/notifications/${w.todoId}/read`);
    expect(notificationRow(w)?.readAt).not.toBeNull();
    const until = Date.now() + 1000;
    snoozeTodo(w.svc, w.todoId, { until });
    expect(sweepSnoozeExpiry(w.svc, until)).toBe(1);
    expect(notificationRow(w)?.readAt).toBeNull();
  });

  test('a needed snooze never expires on the clock and the sweep is idempotent', async () => {
    const w = await world();
    snoozeTodo(w.svc, w.todoId, { until: 'needed' });
    expect(sweepSnoozeExpiry(w.svc, Date.now() + 10 * 365 * 24 * 3_600_000)).toBe(0);
    expect(row(w)?.snoozeMode).toBe('needed');
    const until = Date.now() + 1000;
    snoozeTodo(w.svc, w.todoId, { until });
    expect(sweepSnoozeExpiry(w.svc, until)).toBe(1);
    expect(sweepSnoozeExpiry(w.svc, until + 1)).toBe(0);
  });
});

describe('a snoozed thread sends no pushes', () => {
  test('a finished run (done) sends 0 pushes and queues no digest item', async () => {
    const w = await world();
    snoozeTodo(w.svc, w.todoId, { until: 'needed' });
    setTodoPhase(w.svc, w.todoId, 'done');
    expect(w.send).not.toHaveBeenCalled();
    expect(w.db.select().from(pushDigestItem).all()).toHaveLength(0);
    expect(row(w)).toMatchObject({ phase: 'done', snoozeMode: 'needed' });
  });

  test('the same finished run pushes after the snooze is lifted', async () => {
    const w = await world();
    snoozeTodo(w.svc, w.todoId, { until: 'needed' });
    unsnoozeTodo(w.svc, w.todoId);
    setTodoPhase(w.svc, w.todoId, 'done');
    expect(
      w.db.select().from(pushDigestItem).all().length + w.send.mock.calls.length,
    ).toBeGreaterThan(0);
  });

  test('digest entries queued before the snooze are dropped at the sweep, not delivered', async () => {
    const w = await world();
    const href = `/app/todo/${w.todoId}`;
    queuePushDigest(w.db, w.user.id, w.team.id, { title: 't', body: 'b', href, tag: 'x' });
    expect(w.db.select().from(pushDigestItem).all()).toHaveLength(1);
    snoozeTodo(w.svc, w.todoId, { until: 'needed' });
    await sweepPushDigest(w.db, w.svc.vapidKeys ?? null);
    expect(w.send).not.toHaveBeenCalled();
    expect(w.db.select().from(pushDigestItem).all()).toHaveLength(0);
  });

  test('queuePushDigest skips a snoozed thread', async () => {
    const w = await world();
    snoozeTodo(w.svc, w.todoId, { until: 'needed' });
    queuePushDigest(w.db, w.user.id, w.team.id, {
      title: 't',
      body: 'b',
      href: `/app/todo/${w.todoId}`,
      tag: 'x',
    });
    expect(w.db.select().from(pushDigestItem).all()).toHaveLength(0);
  });
});

describe('snooze end conditions (table)', () => {
  const claimRunningStep = (w: World) =>
    w.db
      .insert(step)
      .values({
        id: 'snooze-running-step',
        buildId: 'snooze-build',
        kind: 'build',
        status: 'claimed',
        createdAt: Date.now(),
      })
      .run();

  const addUserMessageRun = async (w: World) => {
    claimRunningStep(w);
    await sendBuildSteer(w.svc, 'snooze-build', { content: 'hello' }, { human: true });
  };

  const scheduledRunFinished = async (w: World) => {
    const s = createSchedule(w.svc, {
      teamId: w.team.id,
      todoId: w.todoId,
      kind: 'daily',
      at: Date.now() + 3_600_000,
      tz: SHANGHAI,
      prompt: 'check',
      createdBy: w.user.id,
    });
    w.db
      .insert(step)
      .values({
        id: 'snooze-step',
        buildId: 'snooze-build',
        kind: 'build',
        status: 'done',
        scheduleId: s.id,
        createdAt: Date.now(),
      })
      .run();
    w.db.update(schedule).set({ lastRunStepId: 'snooze-step' }).where(eq(schedule.id, s.id)).run();
    const stepRow = w.db.select().from(step).where(eq(step.id, 'snooze-step')).get();
    if (!stepRow) throw new Error('step missing');
    finishScheduledStep(w.svc, stepRow);
  };

  const scheduleCleared = async (w: World) => {
    const s = createSchedule(w.svc, {
      teamId: w.team.id,
      todoId: w.todoId,
      kind: 'daily',
      at: Date.now() + 3_600_000,
      tz: SHANGHAI,
      prompt: 'check',
      createdBy: w.user.id,
    });
    expect((await req(w.app, 'DELETE', `/api/schedules/${s.id}`)).status).toBe(204);
  };

  const needsYou = async (w: World) => {
    setTodoPhase(w.svc, w.todoId, 'review');
  };

  const githubEventDelivered = async (w: World) => {
    w.db
      .insert(message)
      .values({
        id: 'github-feedback:snooze',
        conversationId: 'snooze-build',
        role: 'user',
        actor: 'reviewer',
        content: 'PR feedback from reviewer',
        createdAt: Date.now(),
      })
      .run();
  };

  const toolCall = async (w: World) => {
    upsertMessage(w.svc, {
      id: 'snooze-tool-call',
      conversationId: 'snooze-build',
      role: 'assistant',
      createdAt: Date.now(),
      content: JSON.stringify({ kind: 'tool_call', name: 'bash', input: { command: 'ls' } }),
    });
  };

  const drivers: Record<SnoozeEvent, (w: World) => Promise<void>> = {
    'user-message': addUserMessageRun,
    'scheduled-run-finished': scheduledRunFinished,
    'schedule-cleared': scheduleCleared,
    'needs-you': needsYou,
    'github-event': githubEventDelivered,
    'tool-call': toolCall,
  };

  test('the table covers exactly the six events and splits four ending, two keeping', () => {
    expect([...SNOOZE_EVENTS].sort()).toEqual(Object.keys(drivers).sort());
    expect(SNOOZE_EVENTS.filter((event) => SNOOZE_EVENT_ENDS_SNOOZE[event])).toEqual([
      'user-message',
      'scheduled-run-finished',
      'schedule-cleared',
      'needs-you',
    ]);
    expect(SNOOZE_EVENTS.filter((event) => !SNOOZE_EVENT_ENDS_SNOOZE[event])).toEqual([
      'github-event',
      'tool-call',
    ]);
  });

  test.each(SNOOZE_EVENTS.map((event) => [event, SNOOZE_EVENT_ENDS_SNOOZE[event]] as const))(
    '%s ends the snooze: %s',
    async (event, ends) => {
      const w = await world();
      snoozeTodo(w.svc, w.todoId, { until: 'needed' });
      w.db.delete(notification).run();
      await drivers[event](w);
      if (ends) {
        expect(row(w)).toMatchObject({ snoozeMode: null, snoozedUntil: null });
        expect(notificationRow(w)).toMatchObject({ readAt: null });
        const unread = (await (
          await req(w.app, 'GET', `/api/teams/${w.team.id}/notifications`)
        ).json()) as { unreadThreadIds: string[] };
        expect(unread.unreadThreadIds).toContain(w.todoId);
      } else {
        expect(row(w)).toMatchObject({ snoozeMode: 'needed' });
        expect(notificationRow(w)).toBeUndefined();
      }
    },
  );

  test.each(SNOOZE_EVENTS.map((event) => [event, SNOOZE_EVENT_ENDS_SNOOZE[event]] as const))(
    'endSnoozeOn(%s) returns %s and honours a timed snooze too',
    (event, ends) => {
      return world().then((w) => {
        snoozeTodo(w.svc, w.todoId, { until: Date.now() + 3_600_000 });
        expect(endSnoozeOn(w.svc, w.todoId, event)).toBe(ends);
        expect(row(w)?.snoozeMode).toBe(ends ? null : 'until');
      });
    },
  );

  test('a thread that is not snoozed is untouched by every event', async () => {
    const w = await world();
    const before = row(w)?.v;
    for (const event of SNOOZE_EVENTS) expect(endSnoozeOn(w.svc, w.todoId, event)).toBe(false);
    expect(row(w)?.v).toBe(before);
  });

  test('a user message on a snoozed thread that is not from a person (agent steer) keeps the snooze', async () => {
    const w = await world();
    snoozeTodo(w.svc, w.todoId, { until: 'needed' });
    w.db
      .insert(step)
      .values({
        id: 'snooze-running-step',
        buildId: 'snooze-build',
        kind: 'build',
        status: 'claimed',
        createdAt: Date.now(),
      })
      .run();
    await sendBuildSteer(w.svc, 'snooze-build', { content: 'agent note' }, {});
    expect(row(w)?.snoozeMode).toBe('needed');
  });

  test('a needs-you event on a snoozed thread still pushes (the snooze is lifted first)', async () => {
    const w = await world();
    w.db
      .update(todo)
      .set({ phase: 'building' })
      .where(and(eq(todo.id, w.todoId)))
      .run();
    snoozeTodo(w.svc, w.todoId, { until: 'needed' });
    setTodoPhase(w.svc, w.todoId, 'failed');
    expect(row(w)?.snoozeMode).toBeNull();
    expect(w.send).toHaveBeenCalled();
  });

  test('a pending worker question lifts the snooze', async () => {
    const w = await world();
    snoozeTodo(w.svc, w.todoId, { until: 'needed' });
    upsertMessage(w.svc, {
      id: 'snooze-question',
      conversationId: 'snooze-build',
      role: 'assistant',
      createdAt: Date.now(),
      content: JSON.stringify({
        kind: ASK_USER_QUESTION_KIND,
        requestId: 'snooze-question',
        status: 'pending',
        questions: [{ header: 'Decision', question: 'Which option?', options: [] }],
        answers: null,
      }),
    });
    expect(row(w)?.snoozeMode).toBeNull();
  });
});
