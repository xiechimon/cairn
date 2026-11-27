import { SILENT_NOTIFICATION_TYPES } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import webpush from 'web-push';
import {
  chief,
  chiefMessage,
  chiefThread,
  dueEvent,
  externalEffect,
  imConnection,
  imTurnOrigin,
  message,
  notification,
  pushSubscription,
  schedule,
  step,
  todo,
} from '../src/db/schema.js';
import { newRecordId, newUuidv7, nowMs } from '../src/lib/ids.js';
import * as builds from '../src/services/builds.js';
import { createOrGetQuestion } from '../src/services/chief-questions.js';
import { finishCoordinatorTurn } from '../src/services/coordinator-steps.js';
import {
  drainEffects,
  effectRegistry,
  reconcileEffects,
} from '../src/services/external-effects.js';
import { createImService } from '../src/services/im/core.js';
import { setImRuntime } from '../src/services/im/runtime.js';
import type { ImAdapter, ImOutboundMessage } from '../src/services/im/types.js';
import { notifyChiefMessage, sweepIdleChiefUnread } from '../src/services/notifications.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createSchedule } from '../src/services/schedules.js';
import { isDesktopActive } from '../src/services/thread-presence.js';
import { createTodo, setTodoPhase } from '../src/services/todos.js';
import {
  bootServer,
  insertMachine,
  openStream,
  postProject,
  req,
  seedSessionRoute,
  startLegacyBuild,
} from './helpers.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  vi.restoreAllMocks();
  setImRuntime(null);
  while (cleanups.length > 0) cleanups.pop()?.();
});

async function setupWorld() {
  const s = bootServer({ pingIntervalMs: 50 });
  cleanups.push(s.dispose);
  const projectId = await postProject(s.app);
  const created = createTodo(s.svc, {
    teamId: s.team.id,
    projectId,
    title: 'Daily digest check',
    spec: '',
    createdBy: s.user.id,
    ownerId: s.user.id,
  });
  const machineId = insertMachine(s);
  seedSessionRoute(s, { provider: 'p', modelId: 'm', machineId });
  const buildId = startLegacyBuild(s, created.id, { withPlan: false });
  return { ...s, projectId, todoId: created.id, buildId, machineId };
}

async function setupImConnection(
  s: Awaited<ReturnType<typeof setupWorld>>,
  platform: 'telegram' | 'slack' = 'telegram',
  chatKey = 'chat-owner-1',
) {
  const sent: Array<{ platform: string; msg: ImOutboundMessage }> = [];
  const makeAdapter = (plat: 'telegram' | 'slack'): ImAdapter => ({
    platform: plat,
    check: async () => ({ ok: true, accountLabel: `@bot-${plat}` }),
    connect: async () => ({
      send: async (msg) => {
        sent.push({ platform: plat, msg });
      },
      stop: async () => {},
    }),
  });
  const im = createImService({
    db: s.db,
    hub: s.hub,
    machineHub: s.machineHub,
    convHub: s.convHub,
    box: s.secretBox,
    user: s.user,
    env: {
      fetch: globalThis.fetch,
      now: () => Date.now(),
      sleep: async () => {},
      connectSocket: () => {
        throw new Error('offline');
      },
    },
    attachmentsDir: s.attachmentsDir,
    reposDir: s.reposDir,
    adapters: { telegram: makeAdapter('telegram'), slack: makeAdapter('slack') },
  });
  setImRuntime(im.runtime);
  const conn = await im.createConnection(
    s.team.id,
    platform,
    platform === 'telegram' ? { botToken: 'tok-1' } : { appToken: 'xapp-1', botToken: 'xoxb-1' },
    {
      pairedSenders: [{ id: 'sender-1', name: 'Owner', chatKey, addedAt: nowMs() }],
    },
  );
  s.db.update(imConnection).set({ status: 'ready' }).where(eq(imConnection.id, conn.id)).run();
  return { im, conn, sent };
}

function insertPushSub(
  s: Awaited<ReturnType<typeof setupWorld>>,
  endpoint = 'https://push.example/sub-1',
  createdAt = nowMs(),
) {
  s.db
    .insert(pushSubscription)
    .values({
      id: newRecordId(),
      userId: s.user.id,
      teamId: s.team.id,
      endpoint,
      p256dh: 'p256dh-key',
      auth: 'auth-key',
      createdAt,
    })
    .run();
}

async function postPresence(
  s: Awaited<ReturnType<typeof setupWorld>>,
  payload: Record<string, unknown>,
) {
  return req(s.app, 'POST', `/api/teams/${s.team.id}/presence`, payload);
}

function moveToReview(svc: Parameters<typeof setTodoPhase>[0], todoId: string) {
  setTodoPhase(svc, todoId, 'building');
  setTodoPhase(svc, todoId, 'review');
}

describe('notify-once presence routing', () => {
  test('schedule_run is not silent in shared notification config', () => {
    expect(SILENT_NOTIFICATION_TYPES).not.toContain('schedule_run');
  });

  test('focused on the same thread immediately marks read and sends 0 banners, 0 IM, 0 push', async () => {
    const s = await setupWorld();
    const { sent } = await setupImConnection(s);
    insertPushSub(s);
    const pushSpy = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });

    const res = await postPresence(s, {
      clientId: 'macbook',
      kind: 'desktop',
      focused: true,
      activeThreadId: s.todoId,
      screenLocked: false,
      systemIdleSec: 1,
      canNotify: true,
      seq: 1,
    });
    expect(res.status).toBe(200);

    const stream = await openStream(s.app, s.team.id);
    try {
      moveToReview(s.svc, s.todoId);
      const frame = (await stream.next((ev) => ev.type === 'notification', 3000)) as {
        notification: { readAt: number | null };
        delivery?: { targetClientId: string | null };
      };
      expect(frame.notification.readAt).not.toBeNull();
      expect(frame.delivery?.targetClientId ?? null).toBeNull();
      expect(sent).toHaveLength(0);
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      stream.close();
    }
  });

  test('focused on another thread suppresses desktop banner, IM, and phone push while keeping unread dot', async () => {
    const s = await setupWorld();
    const otherTodo = createTodo(s.svc, {
      teamId: s.team.id,
      projectId: s.projectId,
      title: 'Other task',
      spec: '',
      createdBy: s.user.id,
      ownerId: s.user.id,
    });
    const { sent } = await setupImConnection(s);
    insertPushSub(s);
    const pushSpy = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });

    const res = await postPresence(s, {
      clientId: 'macbook',
      kind: 'desktop',
      focused: true,
      activeThreadId: otherTodo.id,
      screenLocked: false,
      systemIdleSec: 2,
      canNotify: true,
      seq: 1,
    });
    expect(res.status).toBe(200);

    const stream = await openStream(s.app, s.team.id);
    try {
      moveToReview(s.svc, s.todoId);
      const frame = (await stream.next((ev) => ev.type === 'notification', 3000)) as {
        notification: { readAt: number | null };
        delivery?: { targetClientId: string | null };
      };
      expect(frame.notification.readAt).toBeNull();
      expect(frame.delivery?.targetClientId ?? null).toBeNull();
      expect(sent).toHaveLength(0);
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      stream.close();
    }
  });

  test('two Macs + web tab + IM + push: selects ONLY the single most-active unlocked desktop', async () => {
    const s = await setupWorld();
    const { sent } = await setupImConnection(s);
    insertPushSub(s);
    const pushSpy = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });

    expect(
      (
        await postPresence(s, {
          clientId: 'mac-mini',
          kind: 'desktop',
          focused: false,
          activeThreadId: null,
          screenLocked: false,
          systemIdleSec: 180,
          canNotify: true,
          seq: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await postPresence(s, {
          clientId: 'web-tab-1',
          kind: 'web',
          focused: false,
          activeThreadId: null,
          screenLocked: false,
          systemIdleSec: 0,
          canNotify: true,
          seq: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await postPresence(s, {
          clientId: 'macbook',
          kind: 'desktop',
          focused: false,
          activeThreadId: null,
          screenLocked: false,
          systemIdleSec: 3,
          canNotify: true,
          seq: 1,
        })
      ).status,
    ).toBe(200);

    const stream = await openStream(s.app, s.team.id);
    try {
      moveToReview(s.svc, s.todoId);
      const frame = (await stream.next((ev) => ev.type === 'notification', 3000)) as {
        delivery?: { id: string; targetClientId: string | null };
      };
      expect(frame.delivery?.targetClientId).toBe('macbook');
      expect(sent).toHaveLength(0);
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      stream.close();
    }
  });

  test('locked Mac enters 60s grace window, reconciles to desktop if unlocked early, and escalates ONCE to 1 IM if still locked', async () => {
    const s = await setupWorld();
    const { sent: tgSent } = await setupImConnection(s, 'telegram', 'tg-1');
    insertPushSub(s);
    const pushSpy = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });

    let fakeNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    expect(
      (
        await postPresence(s, {
          clientId: 'macbook',
          kind: 'desktop',
          focused: false,
          activeThreadId: null,
          screenLocked: false,
          systemIdleSec: 1,
          canNotify: true,
          seq: 1,
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await postPresence(s, {
          clientId: 'macbook',
          kind: 'desktop',
          focused: false,
          activeThreadId: null,
          screenLocked: true,
          systemIdleSec: 5,
          canNotify: true,
          seq: 2,
        })
      ).status,
    ).toBe(200);

    moveToReview(s.svc, s.todoId);
    expect(tgSent).toHaveLength(0);
    expect(pushSpy).not.toHaveBeenCalled();
    const due = s.db
      .select()
      .from(dueEvent)
      .where(eq(dueEvent.id, `notification-away:${s.user.id}:${s.todoId}`))
      .get();
    expect(due).toBeDefined();

    // Unlocking after 20s cancels away escalation and delivers to macbook once.
    fakeNow += 20_000;
    const stream = await openStream(s.app, s.team.id);
    try {
      expect(
        (
          await postPresence(s, {
            clientId: 'macbook',
            kind: 'desktop',
            focused: false,
            activeThreadId: null,
            screenLocked: false,
            systemIdleSec: 0,
            canNotify: true,
            seq: 3,
          })
        ).status,
      ).toBe(200);
      const frame = (await stream.next((ev) => ev.type === 'notification', 3000)) as {
        delivery?: { targetClientId: string | null };
      };
      expect(frame.delivery?.targetClientId).toBe('macbook');
      expect(tgSent).toHaveLength(0);
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      stream.close();
    }
  });

  test('away sends exactly 1 IM message (0 duplicate push) and falls back to 1 newest push device when no IM is ready', async () => {
    const s = await setupWorld();
    const firstSub = 'https://push.example/old-device';
    const secondSub = 'https://push.example/new-device';
    insertPushSub(s, firstSub, 1000);
    insertPushSub(s, secondSub, 2000);
    const pushSpy = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });

    // 1. With NO IM and NO active desktop: sends to AT MOST ONE newest push device.
    moveToReview(s.svc, s.todoId);
    await vi.waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1));
    expect(pushSpy.mock.calls[0]?.[0]?.endpoint).toBe(secondSub);

    // 2. With ready IM connection + push subscriptions: sends ONLY 1 IM, 0 push.
    pushSpy.mockClear();
    const { sent } = await setupImConnection(s, 'telegram', 'tg-chat');
    const secondTodo = createTodo(s.svc, {
      teamId: s.team.id,
      projectId: s.projectId,
      title: 'Second alert',
      spec: '',
      createdBy: s.user.id,
      ownerId: s.user.id,
    });
    startLegacyBuild(s, secondTodo.id, { withPlan: false });
    moveToReview(s.svc, secondTodo.id);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(pushSpy).not.toHaveBeenCalled();
  });

  test('an idle focused web tab never suppresses away alerts', async () => {
    const s = await setupWorld();
    const { sent } = await setupImConnection(s, 'telegram', 'tg-idle');
    expect(
      (
        await postPresence(s, {
          clientId: 'idle-browser-tab',
          kind: 'web',
          focused: true,
          activeThreadId: s.todoId,
          screenLocked: false,
          systemIdleSec: 900,
          canNotify: true,
          seq: 1,
        })
      ).status,
    ).toBe(200);

    moveToReview(s.svc, s.todoId);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const row = s.db.select().from(notification).where(eq(notification.entityId, s.todoId)).get();
    expect(row?.readAt).toBeNull();
  });

  test('Chief schedule run notifies ONCE with summary or failure reason (no duplicate notifyChiefTurn) and todo_done preserves schedule_run', async () => {
    const s = await setupWorld();
    expect(
      (
        await postPresence(s, {
          clientId: 'macbook',
          kind: 'desktop',
          focused: false,
          activeThreadId: null,
          screenLocked: false,
          systemIdleSec: 1,
          canNotify: true,
          seq: 1,
        })
      ).status,
    ).toBe(200);

    const threadId = `chief-${newUuidv7()}`;
    const chiefId = `chief-${s.user.id}-${s.team.id}`;
    const now = nowMs();
    s.db
      .insert(chief)
      .values({ id: chiefId, teamId: s.team.id, userId: s.user.id, createdAt: now })
      .onConflictDoNothing()
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: threadId,
        chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        title: 'Morning check',
        createdAt: now,
        updatedAt: now,
        sessionId: newUuidv7(),
        sessionOpenedAt: now,
      })
      .run();
    const sched = createSchedule(
      s.svc,
      {
        teamId: s.team.id,
        createdBy: s.user.id,
        chiefThreadId: threadId,
        kind: 'once',
        at: now + 900_000,
        prompt: 'Check CI status',
        tz: 'UTC',
      },
      { allowAnyMinute: true },
    );
    const stepId = newRecordId();
    s.db
      .insert(step)
      .values({
        id: stepId,
        buildId: threadId,
        kind: 'chief',
        status: 'claimed',
        prompt: '<cairn_trigger>user</cairn_trigger>\nCheck CI status',
        scheduleId: sched.id,
        scheduledBy: s.user.id,
        claimedAt: now,
        createdAt: now,
      })
      .run();
    s.db
      .update(schedule)
      .set({ lastRunStepId: stepId, lastRunStatus: 'started' })
      .where(eq(schedule.id, sched.id))
      .run();
    s.db
      .insert(chiefMessage)
      .values({
        id: newRecordId(),
        threadId,
        role: 'assistant',
        content: 'CI is green across all 3 jobs.',
        createdAt: now + 10,
      })
      .run();

    const frames: Array<{
      notification: { type: string; entityId: string; snippet: string | null };
      delivery?: { targetClientId: string | null };
    }> = [];
    const stream = await openStream(s.app, s.team.id);
    try {
      const stepRow = s.db.select().from(step).where(eq(step.id, stepId)).get()!;
      finishCoordinatorTurn(
        {
          db: s.db,
          hub: s.hub,
          machineHub: s.machineHub,
          convHub: s.convHub,
          user: s.user,
          vapidKeys: s.vapidKeys,
          box: s.secretBox,
          reposDir: s.reposDir,
          attachmentsDir: s.attachmentsDir,
          skillsDir: s.skillsDir,
        },
        stepRow,
        { status: 'success' },
      );
      const first = (await stream.next(
        (ev) => ev.type === 'notification',
        3000,
      )) as (typeof frames)[number];
      frames.push(first);
      // Confirm no duplicate chief_message notification follows on the stream.
      const maybeSecond = await stream
        .next((ev) => ev.type === 'notification', 200)
        .catch(() => null);
      expect(maybeSecond).toBeNull();
      expect(first.notification.type).toBe('schedule_run');
      expect(first.notification.entityId).toBe(threadId);
      expect(first.notification.snippet).toContain('CI is green');
      expect(first.delivery?.targetClientId).toBe('macbook');
    } finally {
      stream.close();
    }

    // Todo schedule completion followed by todo_done must preserve schedule_run and delivery target.
    const todoStep = s.db.select().from(step).where(eq(step.buildId, s.buildId)).get()!;
    const todoSched = createSchedule(
      s.svc,
      {
        teamId: s.team.id,
        createdBy: s.user.id,
        todoId: s.todoId,
        kind: 'once',
        at: now + 900_000,
        prompt: 'Check build',
        tz: 'UTC',
      },
      { allowAnyMinute: true },
    );
    s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, s.todoId)).run();
    s.db
      .update(schedule)
      .set({ lastRunStepId: todoStep.id, lastRunStatus: 'started' })
      .where(eq(schedule.id, todoSched.id))
      .run();
    s.db.update(step).set({ scheduleId: todoSched.id }).where(eq(step.id, todoStep.id)).run();
    s.db
      .insert(message)
      .values({
        id: newRecordId(),
        conversationId: s.buildId,
        role: 'assistant',
        content: 'Build finished cleanly.',
        createdAt: now + 20,
      })
      .run();
    builds.completeStep(s.svc, todoStep.id);
    const notif = s.db.select().from(notification).where(eq(notification.entityId, s.todoId)).get();
    expect(notif?.type).toBe('schedule_run');
    expect(notif?.snippet).toContain('Build finished cleanly');
  });

  test('Chief question creates 1 notification and 0 duplicate push while desktop is active', async () => {
    const s = await setupWorld();
    const { sent } = await setupImConnection(s);
    insertPushSub(s);
    const pushSpy = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    expect(
      (
        await postPresence(s, {
          clientId: 'macbook',
          kind: 'desktop',
          focused: false,
          activeThreadId: null,
          screenLocked: false,
          systemIdleSec: 2,
          canNotify: true,
          seq: 1,
        })
      ).status,
    ).toBe(200);

    const threadId = `chief-${newUuidv7()}`;
    const chiefId = `chief-${s.user.id}-${s.team.id}`;
    const now = nowMs();
    s.db
      .insert(chief)
      .values({ id: chiefId, teamId: s.team.id, userId: s.user.id, createdAt: now })
      .onConflictDoNothing()
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: threadId,
        chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        title: 'Deploy check',
        createdAt: now,
        updatedAt: now,
        sessionId: newUuidv7(),
        sessionOpenedAt: now,
      })
      .run();

    const stream = await openStream(s.app, s.team.id);
    try {
      createOrGetQuestion(
        { db: s.db, hub: s.hub, convHub: s.convHub, user: s.user, vapidKeys: s.vapidKeys },
        {
          threadId,
          requestId: 'req-1',
          questions: [
            {
              header: 'Deploy',
              question: 'Ship now?',
              options: [{ label: 'Yes', description: 'Deploy' }],
            },
          ],
          askedFor: ['m-1'],
        },
      );
      const frame = (await stream.next((ev) => ev.type === 'notification', 3000)) as {
        delivery?: { targetClientId: string | null };
      };
      expect(frame.delivery?.targetClientId).toBe('macbook');
      expect(sent).toHaveLength(0);
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      stream.close();
    }
  });

  test('reading anywhere cancels pending_away and broadcasts SSE readAt for cross-device banner dismissal', async () => {
    const s = await setupWorld();
    const { sent } = await setupImConnection(s);
    const fakeNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    expect(
      (
        await postPresence(s, {
          clientId: 'macbook',
          kind: 'desktop',
          focused: false,
          activeThreadId: null,
          screenLocked: true,
          systemIdleSec: 5,
          canNotify: true,
          seq: 1,
        })
      ).status,
    ).toBe(200);

    moveToReview(s.svc, s.todoId);
    expect(
      s.db
        .select()
        .from(dueEvent)
        .where(eq(dueEvent.id, `notification-away:${s.user.id}:${s.todoId}`))
        .get(),
    ).toBeDefined();

    const stream = await openStream(s.app, s.team.id);
    try {
      const readRes = await req(
        s.app,
        'POST',
        `/api/teams/${s.team.id}/notifications/${s.todoId}/read`,
      );
      expect(readRes.status).toBe(200);
      const frame = (await stream.next((ev) => ev.type === 'notification', 3000)) as {
        notification: { readAt: number | null };
      };
      expect(frame.notification.readAt).not.toBeNull();
      expect(
        s.db
          .select()
          .from(dueEvent)
          .where(eq(dueEvent.id, `notification-away:${s.user.id}:${s.todoId}`))
          .get(),
      ).toBeUndefined();
      expect(sent).toHaveLength(0);
    } finally {
      stream.close();
    }
  });

  test('explicit delivery-failed with matching deliveryId falls back to away, while stale deliveryId is ignored', async () => {
    const s = await setupWorld();
    const { sent } = await setupImConnection(s);
    expect(
      (
        await postPresence(s, {
          clientId: 'macbook',
          kind: 'desktop',
          focused: false,
          activeThreadId: null,
          screenLocked: false,
          systemIdleSec: 1,
          canNotify: true,
          seq: 1,
        })
      ).status,
    ).toBe(200);

    const stream = await openStream(s.app, s.team.id);
    let deliveryId = '';
    try {
      moveToReview(s.svc, s.todoId);
      const frame = (await stream.next((ev) => ev.type === 'notification', 3000)) as {
        delivery?: { id: string; targetClientId: string | null };
      };
      deliveryId = frame.delivery?.id ?? '';
      expect(deliveryId).not.toBe('');
    } finally {
      stream.close();
    }

    const staleRes = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/notifications/${s.todoId}/delivery-failed`,
      { deliveryId: 'wrong-gen' },
    );
    expect(staleRes.status).toBe(409);
    expect(sent).toHaveLength(0);

    const failRes = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/notifications/${s.todoId}/delivery-failed`,
      { deliveryId },
    );
    expect(failRes.status).toBe(200);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  test('IM-originated turn does not duplicate an away notice or desktop banner', async () => {
    const s = await setupWorld();
    const { conn, sent } = await setupImConnection(s);
    expect(
      (
        await postPresence(s, {
          clientId: 'macbook',
          kind: 'desktop',
          focused: false,
          activeThreadId: null,
          screenLocked: false,
          systemIdleSec: 1,
          canNotify: true,
          seq: 1,
        })
      ).status,
    ).toBe(200);

    const threadId = `chief-${newUuidv7()}`;
    const chiefId = `chief-${s.user.id}-${s.team.id}`;
    const now = nowMs();
    s.db
      .insert(chief)
      .values({ id: chiefId, teamId: s.team.id, userId: s.user.id, createdAt: now })
      .onConflictDoNothing()
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: threadId,
        chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        title: 'IM thread',
        createdAt: now,
        updatedAt: now,
        sessionId: newUuidv7(),
        sessionOpenedAt: now,
      })
      .run();
    const stepId = newRecordId();
    s.db
      .insert(step)
      .values({
        id: stepId,
        buildId: threadId,
        kind: 'chief',
        status: 'claimed',
        ownerMessageIds: [],
        createdAt: now,
      })
      .run();
    s.db
      .insert(imTurnOrigin)
      .values({
        stepId,
        connId: conn.id,
        chatKey: 'chat-owner-1',
        senderId: 'sender-1',
        threadId,
        createdAt: now,
      })
      .run();

    const stream = await openStream(s.app, s.team.id);
    try {
      notifyChiefMessage(
        { db: s.db, hub: s.hub, user: s.user },
        {
          threadId,
          message: 'Done from IM',
          agent: { name: 'Coordinator', avatarUrl: null },
        },
      );
      const frame = (await stream.next((ev) => ev.type === 'notification', 3000)) as {
        delivery?: { targetClientId: string | null };
      };
      expect(frame.delivery?.targetClientId ?? null).toBeNull();
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(s.db.select().from(externalEffect).all()).toHaveLength(1);
    } finally {
      stream.close();
    }
  });

  test('scheduler pre-step failure emits schedule_run notification with error reason', async () => {
    const s = await setupWorld();
    const now = nowMs();
    const sched = createSchedule(
      s.svc,
      {
        teamId: s.team.id,
        createdBy: s.user.id,
        todoId: s.todoId,
        kind: 'once',
        at: now - 1000,
        prompt: 'Check',
        tz: 'UTC',
      },
      { allowAnyMinute: true },
    );
    moveToReview(s.svc, s.todoId);
    s.db
      .update(schedule)
      .set({ kind: 'cron', cron: 'invalid cron', nextRunAt: now - 1000 })
      .where(eq(schedule.id, sched.id))
      .run();
    const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
    await scheduler.tick(now);
    scheduler.stop();
    const notif = s.db.select().from(notification).where(eq(notification.entityId, s.todoId)).get();
    expect(notif?.type).toBe('schedule_run');
    expect(notif?.snippet).toBeTruthy();
  });

  test('sweepIdleChiefUnread clears pending_away due_event as well', async () => {
    const s = await setupWorld();
    expect(
      (
        await postPresence(s, {
          clientId: 'macbook',
          kind: 'desktop',
          focused: false,
          activeThreadId: null,
          screenLocked: true,
          systemIdleSec: 5,
          canNotify: true,
          seq: 1,
        })
      ).status,
    ).toBe(200);
    const threadId = `chief-${newUuidv7()}`;
    const chiefId = `chief-${s.user.id}-${s.team.id}`;
    const old = nowMs() - 8 * 24 * 60 * 60 * 1000;
    s.db
      .insert(chief)
      .values({ id: chiefId, teamId: s.team.id, userId: s.user.id, createdAt: old })
      .onConflictDoNothing()
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: threadId,
        chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        title: 'Old chief',
        createdAt: old,
        updatedAt: old,
        lastTurnAt: old,
        sessionId: newUuidv7(),
        sessionOpenedAt: old,
      })
      .run();
    notifyChiefMessage(
      { db: s.db, hub: s.hub, user: s.user },
      { threadId, message: 'Hello', agent: { name: 'Coordinator', avatarUrl: null } },
    );
    expect(
      s.db
        .select()
        .from(dueEvent)
        .where(eq(dueEvent.id, `notification-away:${s.user.id}:${threadId}`))
        .get(),
    ).toBeDefined();
    sweepIdleChiefUnread({ db: s.db, hub: s.hub }, nowMs());
    const row = s.db.select().from(notification).where(eq(notification.entityId, threadId)).get();
    expect(row?.readAt).not.toBeNull();
    expect(
      s.db
        .select()
        .from(dueEvent)
        .where(eq(dueEvent.id, `notification-away:${s.user.id}:${threadId}`))
        .get(),
    ).toBeUndefined();
  });

  test('server restart recovers queued away-push effect via scheduler registration before any new notice', async () => {
    const s = await setupWorld();
    const pushSend = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({
      statusCode: 201,
      body: '',
      headers: {},
    });
    const subId = newRecordId();
    s.db
      .insert(pushSubscription)
      .values({
        id: subId,
        teamId: s.team.id,
        userId: s.user.id,
        endpoint: 'https://push.example/recover',
        p256dh: 'p256dh',
        auth: 'auth',
        createdAt: nowMs(),
      })
      .run();
    const notifId = `${s.user.id}:${s.todoId}`;
    const deliveryId = 'deliv-restart-1';
    const createdAt = nowMs() - 60_000;
    s.db
      .insert(notification)
      .values({
        id: notifId,
        teamId: s.team.id,
        userId: s.user.id,
        type: 'build_review',
        entityId: s.todoId,
        entityRef: { title: 'Restart task', projectId: s.projectId, seqNum: 1 },
        agentName: s.user.displayName,
        agentAvatarUrl: s.user.avatarUrl,
        snippet: null,
        readAt: null,
        createdAt,
        channels: ['in_app'],
        deliveryId,
        deliveryStatus: 'away',
        deliveryTarget: 'push',
        deliveryDueAt: null,
      })
      .run();
    const effectId = newRecordId();
    s.db
      .insert(externalEffect)
      .values({
        id: effectId,
        teamId: s.team.id,
        scopeKind: 'todo',
        scopeId: s.todoId,
        kind: 'away-push',
        dedupeKey: `away-push:${notifId}:${deliveryId}`,
        payload: {
          notificationId: notifId,
          userId: s.user.id,
          teamId: s.team.id,
          msg: {
            title: '构建待审核',
            body: 'Restart task',
            href: `/app/todo/${s.todoId}`,
            tag: notifId,
          },
          deliveryId,
        },
        state: 'pending',
        attempts: 0,
        dueAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      })
      .run();

    // Clear registry entry as a cold server restart would, then initialize scheduler on boot.
    effectRegistry.delete('away-push');
    const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
    await reconcileEffects(s.db, effectRegistry, nowMs());
    await drainEffects(s.db, effectRegistry, { now: nowMs() });
    scheduler.stop();

    expect(pushSend).toHaveBeenCalledTimes(1);
    const updatedEffect = s.db
      .select()
      .from(externalEffect)
      .where(eq(externalEffect.id, effectId))
      .get();
    expect(updatedEffect?.state).toBe('delivered');
  });

  test('isDesktopActive returns false when unlocked desktop disabled Cairn notifications (mail still pushes)', async () => {
    const s = await setupWorld();
    expect(
      (
        await postPresence(s, {
          clientId: 'macbook-muted',
          kind: 'desktop',
          focused: false,
          activeThreadId: null,
          screenLocked: false,
          systemIdleSec: 5,
          canNotify: false,
          seq: 1,
        })
      ).status,
    ).toBe(200);
    expect(isDesktopActive(s.db, s.user.id, nowMs())).toBe(false);

    expect(
      (
        await postPresence(s, {
          clientId: 'macbook-muted',
          kind: 'desktop',
          focused: false,
          activeThreadId: null,
          screenLocked: false,
          systemIdleSec: 5,
          canNotify: true,
          seq: 2,
        })
      ).status,
    ).toBe(200);
    expect(isDesktopActive(s.db, s.user.id, nowMs())).toBe(true);
  });
});
