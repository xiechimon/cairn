import { ASK_USER_QUESTION_KIND, type Phase } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test, vi } from 'vitest';
import webpush from 'web-push';
import {
  build,
  message,
  project,
  pushDelivery,
  pushDigestItem,
  pushSubscription,
  todo,
} from '../src/db/schema.js';
import { upsertMessage } from '../src/services/machine-deps.js';
import { pushToUserSafely, queuePushDigest, sweepPushDigest } from '../src/services/push.js';
import { notifyThreadPhase } from '../src/services/thread-push.js';
import { createTodo, getTodo, setTodoPhase } from '../src/services/todos.js';
import { bootServer, postProject, req } from './helpers.js';

async function world(phase: Phase = 'building') {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const record = createTodo(s.svc, {
    teamId: s.team.id,
    projectId,
    title: 'Archived task',
    spec: '',
    createdBy: s.user.id,
    ownerId: s.user.id,
  });
  s.db
    .insert(build)
    .values({
      id: 'archive-push-build',
      todoId: record.id,
      triggerSource: 'user',
      withPlan: false,
      prNumber: 42,
      createdAt: Date.now(),
    })
    .run();
  s.db
    .update(todo)
    .set({ phase, latestBuildId: 'archive-push-build' })
    .where(eq(todo.id, record.id))
    .run();
  s.db
    .insert(pushSubscription)
    .values({
      id: 'archive-push-sub',
      userId: s.user.id,
      teamId: s.team.id,
      endpoint: 'https://push.example/archive',
      p256dh: 'key',
      auth: 'auth',
      createdAt: Date.now(),
    })
    .run();
  const send = vi
    .spyOn(webpush, 'sendNotification')
    .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  const payload = {
    title: 'Archived event',
    body: 'Archived event',
    href: `/app/todo/${record.id}`,
    tag: `${s.user.id}:${record.id}`,
  };
  return { ...s, record, send, payload };
}

afterEach(() => vi.restoreAllMocks());

test.each(['done', 'failed', 'confirm', 'review'] as const)(
  'archived %s phase events remain silent without preventing reconciliation',
  async (phase) => {
    const s = await world(phase === 'confirm' ? 'planning' : 'building');
    expect((await req(s.app, 'POST', `/api/todos/${s.record.id}/archive`)).status).toBe(200);
    setTodoPhase(s.svc, s.record.id, phase);
    expect(s.send).not.toHaveBeenCalled();
    expect(s.db.select().from(pushDigestItem).all()).toHaveLength(0);
    expect(s.db.select().from(todo).where(eq(todo.id, s.record.id)).get()).toMatchObject({
      phase,
      archivedAt: expect.any(Number),
    });
  },
);

test('a phase record captured before archive cannot send or queue a notification', async () => {
  const s = await world();
  const captured = getTodo(s.svc, s.record.id);
  if (!captured) throw new Error('Missing task');
  expect((await req(s.app, 'POST', `/api/todos/${s.record.id}/archive`)).status).toBe(200);
  notifyThreadPhase(s.svc, captured, 'done');
  expect(s.send).not.toHaveBeenCalled();
  expect(s.db.select().from(pushDigestItem).all()).toHaveLength(0);
});

test('archived PR review entries create neither a push claim nor a digest entry', async () => {
  const s = await world();
  s.db
    .update(project)
    .set({ repoKind: 'github', githubRepo: 'owner/repository' })
    .where(eq(project.id, s.record.projectId))
    .run();
  expect((await req(s.app, 'POST', `/api/todos/${s.record.id}/archive`)).status).toBe(200);
  setTodoPhase(s.svc, s.record.id, 'review');
  expect(s.send).not.toHaveBeenCalled();
  expect(s.db.select().from(pushDelivery).all()).toHaveLength(0);
  expect(s.db.select().from(pushDigestItem).all()).toHaveLength(0);
});

test('archived worker questions retain their transcript without pushing', async () => {
  const s = await world();
  expect((await req(s.app, 'POST', `/api/todos/${s.record.id}/archive`)).status).toBe(200);
  upsertMessage(s.svc, {
    id: 'archived-question',
    conversationId: 'archive-push-build',
    role: 'assistant',
    createdAt: Date.now(),
    content: JSON.stringify({
      kind: ASK_USER_QUESTION_KIND,
      requestId: 'archived-question',
      status: 'pending',
      questions: [{ header: 'Decision', question: 'Which option?', options: [] }],
      answers: null,
    }),
  });
  expect(s.send).not.toHaveBeenCalled();
  expect(
    s.db.select().from(message).where(eq(message.id, 'archived-question')).get(),
  ).toBeDefined();
});

test('direct thread notification helpers suppress archived tasks', async () => {
  const s = await world();
  expect((await req(s.app, 'POST', `/api/todos/${s.record.id}/archive`)).status).toBe(200);
  pushToUserSafely(s.db, s.vapidKeys, s.user.id, s.team.id, s.payload);
  queuePushDigest(s.db, s.user.id, s.team.id, s.payload);
  expect(s.send).not.toHaveBeenCalled();
  expect(s.db.select().from(pushDigestItem).all()).toHaveLength(0);
});

test('digest sweep drops an event queued before its task was archived', async () => {
  const s = await world();
  queuePushDigest(s.db, s.user.id, s.team.id, s.payload);
  expect((await req(s.app, 'POST', `/api/todos/${s.record.id}/archive`)).status).toBe(200);
  await sweepPushDigest(s.db, s.vapidKeys);
  expect(s.send).not.toHaveBeenCalled();
  expect(s.db.select().from(pushDigestItem).all()).toHaveLength(0);
});

test('digest sweep retains active task events while dropping archived ones', async () => {
  const s = await world();
  const active = createTodo(s.svc, {
    teamId: s.team.id,
    projectId: s.record.projectId,
    title: 'Active task',
    spec: '',
    createdBy: s.user.id,
    ownerId: s.user.id,
  });
  queuePushDigest(s.db, s.user.id, s.team.id, s.payload);
  queuePushDigest(s.db, s.user.id, s.team.id, {
    ...s.payload,
    title: 'Active event',
    body: 'Active event',
    href: `/app/todo/${active.id}`,
  });
  expect((await req(s.app, 'POST', `/api/todos/${s.record.id}/archive`)).status).toBe(200);
  await sweepPushDigest(s.db, s.vapidKeys);
  expect(s.send).toHaveBeenCalledTimes(1);
  const payload = JSON.parse(String(s.send.mock.calls[0]?.[1])) as {
    notification: { body: string };
  };
  expect(payload.notification.body).toContain('Active event');
  expect(payload.notification.body).not.toContain('Archived event');
});
