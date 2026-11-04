import { notificationRecordSchema } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent, build, notification, schedule, step, todo } from '../src/db/schema.js';
import * as builds from '../src/services/builds.js';
import { createSchedule } from '../src/services/schedules.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, insertMachine, openStream, postProject, req } from './helpers.js';

async function world() {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const created = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'Thread', spec: '' })
  ).json()) as { id: string };
  builds.startBuilds(s.svc, {
    projectId,
    todoIds: [created.id],
    assignment: { plan: null, build: null },
    withPlan: false,
  });
  return { ...s, projectId, todoId: created.id };
}

type World = Awaited<ReturnType<typeof world>>;

const rowOf = (w: World, entityId = w.todoId) =>
  w.db
    .select()
    .from(notification)
    .where(eq(notification.id, `${w.user.id}:${entityId}`))
    .get();

const listUnread = async (w: World, teamId = w.team.id) =>
  (
    (await (await req(w.app, 'GET', `/api/teams/${teamId}/notifications`)).json()) as {
      unreadThreadIds: string[];
    }
  ).unreadThreadIds;

const post = (w: World, action: 'read' | 'unread', entityId = w.todoId, teamId = w.team.id) =>
  req(w.app, 'POST', `/api/teams/${teamId}/notifications/${entityId}/${action}`);

function insertForeignNotification(w: World, over: Partial<typeof notification.$inferInsert>) {
  w.db
    .insert(notification)
    .values({
      id: 'foreign:row',
      teamId: 'other-team',
      userId: w.user.id,
      type: 'todo_done',
      entityId: 'foreign-entity',
      entityRef: { title: 'Elsewhere', projectId: null, seqNum: null },
      agentName: 'x',
      agentAvatarUrl: null,
      snippet: null,
      readAt: null,
      createdAt: Date.now(),
      channels: ['in_app'],
      ...over,
    })
    .run();
}

describe('phase entry upserts an unread notification', () => {
  test('entering done', async () => {
    const w = await world();
    setTodoPhase(w.svc, w.todoId, 'building');
    setTodoPhase(w.svc, w.todoId, 'done');
    expect(rowOf(w)).toMatchObject({ type: 'todo_done', readAt: null, teamId: w.team.id });
    expect(await listUnread(w)).toEqual([w.todoId]);
  });

  test('entering failed', async () => {
    const w = await world();
    setTodoPhase(w.svc, w.todoId, 'building');
    setTodoPhase(w.svc, w.todoId, 'failed');
    expect(rowOf(w)).toMatchObject({ type: 'todo_failed', readAt: null });
  });

  test('entering review', async () => {
    const w = await world();
    setTodoPhase(w.svc, w.todoId, 'building');
    setTodoPhase(w.svc, w.todoId, 'review');
    expect(rowOf(w)).toMatchObject({ type: 'build_review', readAt: null });
  });

  test('entering confirm', async () => {
    const w = await world();
    setTodoPhase(w.svc, w.todoId, 'planning');
    setTodoPhase(w.svc, w.todoId, 'confirm');
    expect(rowOf(w)).toMatchObject({ type: 'plan_ready', readAt: null });
  });

  test('a later phase entry makes a read thread unread again and keeps a single row', async () => {
    const w = await world();
    setTodoPhase(w.svc, w.todoId, 'building');
    setTodoPhase(w.svc, w.todoId, 'review');
    expect((await post(w, 'read')).status).toBe(200);
    expect(await listUnread(w)).toEqual([]);
    setTodoPhase(w.svc, w.todoId, 'done');
    expect(rowOf(w)).toMatchObject({ type: 'todo_done', readAt: null });
    expect(await listUnread(w)).toEqual([w.todoId]);
    expect(
      w.db.select().from(notification).where(eq(notification.entityId, w.todoId)).all(),
    ).toHaveLength(1);
  });

  test('phases that need nothing from the user create no row', async () => {
    const w = await world();
    setTodoPhase(w.svc, w.todoId, 'building');
    expect(rowOf(w)).toBeUndefined();
  });
});

describe('a scheduled run finishing upserts an unread notification', () => {
  async function scheduled(kind: 'cron' | 'once' = 'cron') {
    const w = await world();
    const machineId = insertMachine(w);
    w.db
      .insert(agent)
      .values({
        id: 'sched-agent',
        teamId: w.team.id,
        displayName: 'Worker',
        provider: 'p',
        modelId: 'm',
        machineId,
      })
      .run();
    const buildRow = w.db.select().from(build).where(eq(build.todoId, w.todoId)).get()!;
    const stepRow = w.db.select().from(step).where(eq(step.buildId, buildRow.id)).get()!;
    w.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, w.todoId)).run();
    const saved = createSchedule(w.svc, {
      teamId: w.team.id,
      createdBy: `worker:${stepRow.id}`,
      todoId: w.todoId,
      prompt: 'Check again',
      tz: 'UTC',
      ...(kind === 'cron'
        ? { kind, cron: '*/15 * * * *' }
        : { kind, at: Math.ceil((Date.now() + 900_000) / 900_000) * 900_000 }),
    });
    w.db.update(schedule).set({ lastRunStepId: stepRow.id }).where(eq(schedule.id, saved.id)).run();
    w.db.update(step).set({ scheduleId: saved.id }).where(eq(step.id, stepRow.id)).run();
    return { w, stepId: stepRow.id };
  }

  test('completed', async () => {
    const { w, stepId } = await scheduled();
    builds.completeStep(w.svc, stepId);
    expect(rowOf(w)).toMatchObject({ type: 'schedule_run', readAt: null });
    expect(await listUnread(w)).toEqual([w.todoId]);
  });

  test('completed once-schedule that deletes itself', async () => {
    const { w, stepId } = await scheduled('once');
    builds.completeStep(w.svc, stepId);
    expect(rowOf(w)).toMatchObject({ type: 'schedule_run', readAt: null });
  });

  test('failed carries the reason', async () => {
    const { w, stepId } = await scheduled();
    const stepRow = w.db.select().from(step).where(eq(step.id, stepId)).get()!;
    builds.applyStepFailure(w.svc, stepRow, 'connection reset');
    expect(rowOf(w)).toMatchObject({ type: 'schedule_run', readAt: null });
    expect(rowOf(w)?.snippet).toContain('connection reset');
  });

  test('a step that is not the schedule latest run creates nothing', async () => {
    const { w, stepId } = await scheduled();
    w.db.update(schedule).set({ lastRunStepId: 'someone-else' }).run();
    builds.completeStep(w.svc, stepId);
    expect(rowOf(w)).toBeUndefined();
  });
});

describe('GET notifications', () => {
  test('lists only the requested team and signed-in user, unread only', async () => {
    const w = await world();
    setTodoPhase(w.svc, w.todoId, 'building');
    setTodoPhase(w.svc, w.todoId, 'done');
    insertForeignNotification(w, {});
    insertForeignNotification(w, {
      id: 'user-other:row',
      teamId: w.team.id,
      userId: 'someone-else',
      entityId: 'other-users-entity',
    });
    insertForeignNotification(w, {
      id: `${w.user.id}:read-one`,
      teamId: w.team.id,
      entityId: 'read-one',
      readAt: Date.now(),
    });
    expect(await listUnread(w)).toEqual([w.todoId]);
  });

  test('unknown team is 404', async () => {
    const w = await world();
    expect((await req(w.app, 'GET', '/api/teams/nope/notifications')).status).toBe(404);
  });
});

describe('POST read / unread', () => {
  test('read flips readAt, drops the id from the list and returns the record', async () => {
    const w = await world();
    setTodoPhase(w.svc, w.todoId, 'building');
    setTodoPhase(w.svc, w.todoId, 'done');
    const res = await post(w, 'read');
    expect(res.status).toBe(200);
    const body = notificationRecordSchema.parse(await res.json());
    expect(body.readAt).not.toBeNull();
    expect(rowOf(w)?.readAt).toBe(body.readAt);
    expect(await listUnread(w)).toEqual([]);
  });

  test('read is idempotent and keeps the first readAt', async () => {
    const w = await world();
    setTodoPhase(w.svc, w.todoId, 'building');
    setTodoPhase(w.svc, w.todoId, 'done');
    expect(rowOf(w)?.readAt).toBeNull();
    await post(w, 'read');
    const readAt = rowOf(w)?.readAt;
    expect(readAt).not.toBeNull();
    await post(w, 'read');
    expect(rowOf(w)?.readAt).toBe(readAt);
  });

  test('unread clears readAt on an existing row', async () => {
    const w = await world();
    setTodoPhase(w.svc, w.todoId, 'building');
    setTodoPhase(w.svc, w.todoId, 'done');
    await post(w, 'read');
    const res = await post(w, 'unread');
    expect(res.status).toBe(200);
    expect(notificationRecordSchema.parse(await res.json()).readAt).toBeNull();
    expect(rowOf(w)).toMatchObject({ type: 'todo_done', readAt: null });
    expect(await listUnread(w)).toEqual([w.todoId]);
  });

  test('unread on a todo that never had a row creates one', async () => {
    const w = await world();
    expect(rowOf(w)).toBeUndefined();
    const res = await post(w, 'unread');
    expect(res.status).toBe(200);
    expect(rowOf(w)).toMatchObject({ type: 'marked_unread', readAt: null, teamId: w.team.id });
    expect(await listUnread(w)).toEqual([w.todoId]);
  });

  test('unread twice leaves one unread row', async () => {
    const w = await world();
    await post(w, 'unread');
    await post(w, 'unread');
    expect(
      w.db.select().from(notification).where(eq(notification.entityId, w.todoId)).all(),
    ).toHaveLength(1);
  });

  test('read with no row is 404', async () => {
    const w = await world();
    expect((await post(w, 'read')).status).toBe(404);
  });

  test('unknown entity is 404 for both routes', async () => {
    const w = await world();
    expect((await post(w, 'read', 'nope')).status).toBe(404);
    expect((await post(w, 'unread', 'nope')).status).toBe(404);
  });

  test('unknown team is 404 for both routes', async () => {
    const w = await world();
    setTodoPhase(w.svc, w.todoId, 'building');
    setTodoPhase(w.svc, w.todoId, 'done');
    expect((await post(w, 'read', w.todoId, 'nope')).status).toBe(404);
    expect((await post(w, 'unread', w.todoId, 'nope')).status).toBe(404);
    expect(rowOf(w)?.readAt).toBeNull();
  });

  test('a row owned by another team cannot be flipped through this team', async () => {
    const w = await world();
    insertForeignNotification(w, { id: `${w.user.id}:foreign-entity` });
    expect((await post(w, 'read', 'foreign-entity')).status).toBe(404);
    expect((await post(w, 'unread', 'foreign-entity')).status).toBe(404);
    expect(
      w.db
        .select()
        .from(notification)
        .where(
          and(eq(notification.entityId, 'foreign-entity'), eq(notification.teamId, 'other-team')),
        )
        .get()?.readAt,
    ).toBeNull();
  });

  test('read publishes the updated record to the team stream', async () => {
    const w = await world();
    setTodoPhase(w.svc, w.todoId, 'building');
    setTodoPhase(w.svc, w.todoId, 'done');
    const stream = await openStream(w.app, w.team.id);
    try {
      await post(w, 'read');
      const frame = (await stream.next(
        (ev) =>
          ev.type === 'notification' &&
          (ev.notification as { readAt: number | null }).readAt !== null,
        3000,
      )) as { notification: { entityId: string } };
      expect(frame.notification.entityId).toBe(w.todoId);
    } finally {
      stream.close();
    }
  });
});
