import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { build, message, queuedMessage, step, todo } from '../src/db/schema.js';
import { replacingStrandedSend } from '../src/services/queued-send.js';
import { req } from './helpers.js';
import { runningTask, type Task } from './running-task.js';

const TEXT = 'Say it exactly once';
const KEY = 'typed-once';

const latestBuild = (w: Task) =>
  w.s.db.select().from(todo).where(eq(todo.id, 'task')).get()!.latestBuildId!;

function copies(w: Task) {
  const sent = w.s.db.select().from(message).where(eq(message.content, TEXT)).all();
  const queued = w.s.db.select().from(queuedMessage).where(eq(queuedMessage.content, TEXT)).all();
  return [...sent, ...queued].map((row) => row.conversationId);
}

function willReachTheAgent(w: Task) {
  const current = latestBuild(w);
  const steps = w.s.db.select().from(step).where(eq(step.buildId, current)).all();
  const queuedBehindLiveTurn =
    w.s.db.select().from(queuedMessage).where(eq(queuedMessage.content, TEXT)).get()
      ?.conversationId === current &&
    steps.some((row) => row.status === 'claimed' || row.status === 'pending');
  const inTranscript =
    w.s.db.select().from(message).where(eq(message.content, TEXT)).get()?.conversationId ===
    current;
  return queuedBehindLiveTurn || (inTranscript && steps.length > 0);
}

const routes = {
  reply: (w: Task) =>
    req(w.s.app, 'POST', '/api/todos/task/messages', { content: TEXT, clientMessageId: KEY }),
  queue: (w: Task) =>
    req(w.s.app, 'POST', `/api/conversations/${latestBuild(w)}/messages`, {
      content: TEXT,
      mode: 'queue',
      clientMessageId: KEY,
    }),
};

const cancelIt = async (w: Task) => {
  const row = w.s.db.select().from(queuedMessage).where(eq(queuedMessage.content, TEXT)).get()!;
  expect(
    (await w.send({ content: TEXT, queuedMessageId: row.id, cancelQueued: true })).status,
  ).toBe(201);
};

const states = {
  'still waiting behind the running turn': async () => {},
  'already handed to the agent': async (w: Task) => {
    expect((await w.finish('success')).status).toBe(200);
  },
  'stranded by a failed turn on the same run': async (w: Task) => {
    expect((await w.finish('failed')).status).toBe(200);
  },
  'stranded on the old run after a retry': async (w: Task) => {
    expect((await w.finish('failed')).status).toBe(200);
    const restarted = await req(w.s.app, 'POST', '/api/builds/build/steps', {
      action: 'restart',
      feedback: 'Try again',
      clientMessageId: 'press-retry',
    });
    expect(restarted.status).toBeLessThan(300);
    expect(latestBuild(w)).not.toBe('build');
    const retried = w.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, latestBuild(w)))
      .get()!;
    const { machineId } = w.s.db.select().from(step).where(eq(step.id, 'running')).get()!;
    w.s.db
      .update(step)
      .set({ status: 'claimed', machineId, sessionId: 'builder-session', claimedAt: 3 })
      .where(eq(step.id, retried.id))
      .run();
    w.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, 'task')).run();
  },
  'cancelled by the user': cancelIt,
} satisfies Record<string, (w: Task) => Promise<void>>;

test.each(
  Object.keys(states).flatMap((state) => [
    [state as keyof typeof states, 'reply' as const],
    [state as keyof typeof states, 'queue' as const],
  ]),
)(
  'resending a queued message %s through the %s route leaves one copy that reaches the agent',
  async (state, route) => {
    const w = await runningTask();
    expect((await w.send({ content: TEXT, mode: 'queue', clientMessageId: KEY })).status).toBe(201);
    await states[state](w);
    const again = await routes[route](w);
    expect(again.status).toBe(201);
    expect(copies(w)).toHaveLength(1);
    expect(willReachTheAgent(w)).toBe(true);
  },
);

test.each(['reply', 'queue'] as const)(
  'a resend through the %s route that cannot be delivered is refused and keeps the queued row',
  async (route) => {
    const w = await runningTask();
    expect((await w.send({ content: TEXT, mode: 'queue', clientMessageId: KEY })).status).toBe(201);
    expect((await w.finish('failed')).status).toBe(200);
    w.s.db.update(todo).set({ archivedAt: 3 }).where(eq(todo.id, 'task')).run();
    expect((await routes[route](w)).status).toBe(409);
    expect(copies(w)).toEqual(['build']);
    w.s.db.update(todo).set({ archivedAt: null }).where(eq(todo.id, 'task')).run();
    expect((await routes[route](w)).status).toBe(201);
    expect(copies(w)).toHaveLength(1);
    expect(willReachTheAgent(w)).toBe(true);
  },
);

test.each(['reply', 'queue'] as const)(
  'a delivered message resent through the %s route is still acknowledged after the task closes',
  async (route) => {
    const w = await runningTask();
    expect((await w.send({ content: TEXT, mode: 'queue', clientMessageId: KEY })).status).toBe(201);
    expect((await w.finish('success')).status).toBe(200);
    w.s.db.update(todo).set({ archivedAt: 3 }).where(eq(todo.id, 'task')).run();
    expect((await routes[route](w)).status).toBe(201);
    expect(copies(w)).toHaveLength(1);
    expect(w.s.db.select().from(build).all()).toHaveLength(1);
  },
);

const EDITED = 'Say it differently';

const queuedRows = (w: Task) => w.s.db.select().from(queuedMessage).all();

test.each(['reply', 'queue'] as const)(
  'a resend through the %s route keeps a queued message edited since it was sent',
  async (route) => {
    const w = await runningTask();
    expect((await w.send({ content: TEXT, mode: 'queue', clientMessageId: KEY })).status).toBe(201);
    const [row] = queuedRows(w);
    expect(
      (await w.send({ content: EDITED, queuedMessageId: row!.id, editQueued: true })).status,
    ).toBe(201);
    expect((await w.finish('failed')).status).toBe(200);
    expect((await routes[route](w)).status).toBe(201);
    expect(copies(w)).toHaveLength(1);
    expect(willReachTheAgent(w)).toBe(true);
    const delivered = w.s.db.select().from(message).where(eq(message.content, EDITED)).all();
    const waiting = queuedRows(w).filter((queued) => queued.content === EDITED);
    expect(delivered.length + waiting.length).toBe(1);
  },
);

test('a message cancelled while its resend is failing stays cancelled', async () => {
  const w = await runningTask();
  expect((await w.send({ content: TEXT, mode: 'queue', clientMessageId: KEY })).status).toBe(201);
  const [row] = queuedRows(w);
  expect((await w.finish('failed')).status).toBe(200);
  const task = w.s.db.select().from(todo).where(eq(todo.id, 'task')).get()!;
  await expect(
    replacingStrandedSend(w.s.db, task, { clientMessageId: KEY, content: TEXT }, async () => {
      await w.send({ content: TEXT, queuedMessageId: row!.id, cancelQueued: true });
      throw new Error('refused');
    }),
  ).rejects.toThrow('refused');
  expect(copies(w)).toEqual([]);
});
