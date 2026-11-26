import { and, eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { build, message, queuedMessage, step, todo } from '../src/db/schema.js';
import { req } from './helpers.js';
import { runningTask, type Task } from './running-task.js';

const TEXTS = ['first waiting', 'second waiting', 'third waiting'];

const latestBuild = (w: Task) =>
  w.s.db.select().from(todo).where(eq(todo.id, 'task')).get()!.latestBuildId!;

const waitingOn = async (w: Task, conversationId: string) => {
  const res = await req(w.s.app, 'GET', `/api/conversations/${conversationId}/messages`);
  const page = (await res.json()) as {
    queuedMessages?: { content: string; deliverAfterStop: boolean }[];
  };
  return (page.queuedMessages ?? []).map((row) => row.content);
};

async function failedWithQueue() {
  const w = await runningTask();
  for (const [index, content] of TEXTS.entries())
    expect(
      (await w.send({ content, mode: 'queue', clientMessageId: `typed-${index}` })).status,
    ).toBe(201);
  expect((await w.finish('failed')).status).toBe(200);
  return w;
}

const pressRetry = async (w: Task) =>
  expect((await req(w.s.app, 'POST', '/api/builds/build/retry-now', {})).status).toBe(202);

async function finishTurn(w: Task, conversationId: string) {
  const pending = w.s.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, conversationId), eq(step.status, 'pending')))
    .get()!;
  const { machineId } = w.s.db.select().from(step).where(eq(step.id, 'running')).get()!;
  w.s.db
    .update(step)
    .set({ status: 'claimed', machineId, sessionId: 'builder-session', claimedAt: Date.now() })
    .where(eq(step.id, pending.id))
    .run();
  w.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, 'task')).run();
  expect((await w.finish('success', pending.id)).status).toBe(200);
}

const handedOver = (w: Task, conversationId: string) =>
  w.s.db
    .select()
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .all()
    .map((row) => row.content)
    .filter((content) => typeof content === 'string' && TEXTS.includes(content));

test('Retry carries the waiting messages to the new run and hands them over in order', async () => {
  const w = await failedWithQueue();
  await pressRetry(w);
  const next = latestBuild(w);
  expect(next).not.toBe('build');
  expect(await waitingOn(w, next)).toEqual(TEXTS);
  expect(await waitingOn(w, 'build')).toEqual([]);
  for (const [index] of TEXTS.entries()) {
    await finishTurn(w, next);
    expect(handedOver(w, next)).toEqual(TEXTS.slice(0, index + 1));
    expect(await waitingOn(w, next)).toEqual(TEXTS.slice(index + 1));
  }
});

test('Retry that reopens an earlier run with a PR carries the waiting messages there', async () => {
  const w = await failedWithQueue();
  w.s.db
    .insert(build)
    .values({
      id: 'earlier',
      todoId: 'task',
      withPlan: false,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt: 0,
      prNumber: 7,
      changes: [],
    })
    .run();
  await pressRetry(w);
  expect(latestBuild(w)).toBe('earlier');
  expect(await waitingOn(w, 'earlier')).toEqual(TEXTS);
});

test('resending a carried message answers with the new run and adds no copy', async () => {
  const w = await failedWithQueue();
  await pressRetry(w);
  const next = latestBuild(w);
  const again = await w.send({ content: TEXTS[0], mode: 'queue', clientMessageId: 'typed-0' });
  expect(again.status).toBe(201);
  expect(await again.json()).toMatchObject({
    conversationId: next,
    message: { conversationId: next, content: TEXTS[0] },
  });
  expect(w.s.db.select().from(queuedMessage).all()).toHaveLength(TEXTS.length);
});

test('removing a message from a page still showing the old run removes the carried one', async () => {
  const w = await failedWithQueue();
  const [first] = w.s.db.select().from(queuedMessage).all();
  await pressRetry(w);
  expect(
    (await w.send({ content: TEXTS[0], queuedMessageId: first!.id, cancelQueued: true })).status,
  ).toBe(201);
  expect(await waitingOn(w, latestBuild(w))).toEqual(TEXTS.slice(1));
});
