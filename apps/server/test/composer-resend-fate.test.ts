import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { build, message, project, queuedMessage, step, todo } from '../src/db/schema.js';
import { sendBuildSteer } from '../src/services/builds.js';
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
  'carried to the new run by a retry': async (w: Task) => {
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
  const later = await routes.queue(w);
  expect(later.status).toBe(409);
  expect(await later.json()).toMatchObject({ reason: 'queued-message-cancelled' });
  expect(copies(w)).toEqual([]);
});

test.each(['reply', 'queue'] as const)(
  'a resend through the %s route of a message removed from the queue is refused every time',
  async (route) => {
    const w = await runningTask();
    expect((await w.send({ content: TEXT, mode: 'queue', clientMessageId: KEY })).status).toBe(201);
    await cancelIt(w);
    for (const _attempt of [1, 2]) {
      const again = await routes[route](w);
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ reason: 'queued-message-cancelled' });
    }
    expect(copies(w)).toEqual([]);
    expect(
      (await w.send({ content: TEXT, mode: 'queue', clientMessageId: 'sent-anew' })).status,
    ).toBe(201);
    expect(copies(w)).toEqual(['build']);
  },
);

const userStop = async (w: Task) => {
  expect((await req(w.s.app, 'POST', '/api/builds/build/stop', { discard: false })).status).toBe(
    202,
  );
  expect((await w.finish('stopped')).status).toBe(200);
};

const deliveredAfterAnEarlierTurn = (w: Task) => {
  w.s.db
    .insert(step)
    .values({ id: 'earlier', buildId: 'build', kind: 'build', status: 'done', createdAt: 0 })
    .run();
};

const stops = {
  'before anything was delivered': () => {},
  'after an earlier delivery': deliveredAfterAnEarlierTurn,
} satisfies Record<string, (w: Task) => void>;

const stopCases = (Object.keys(stops) as (keyof typeof stops)[]).flatMap((stopped) =>
  (['reply', 'queue'] as const).map((route) => [stopped, route] as const),
);

const stepStatuses = (w: Task) =>
  w.s.db
    .select()
    .from(step)
    .all()
    .map((row) => row.status)
    .sort();

test.each(stopCases)(
  'resending a message held by a Stop %s through the %s route keeps it waiting and starts nothing',
  async (stopped, route) => {
    const w = await runningTask();
    stops[stopped](w);
    expect((await w.send({ content: TEXT, mode: 'queue', clientMessageId: KEY })).status).toBe(201);
    await userStop(w);
    const before = stepStatuses(w);
    expect((await routes[route](w)).status).toBe(201);
    expect(copies(w)).toEqual(['build']);
    expect(w.s.db.select().from(queuedMessage).all()).toHaveLength(1);
    expect(stepStatuses(w)).toEqual(before);
    expect(latestBuild(w)).toBe('build');
  },
);

test('a scheduled wake never restarts a task the user stopped', async () => {
  const w = await runningTask();
  await userStop(w);
  const wake = { id: 'wake', createdBy: 'user', at: 5, expected: 5, next: null, triggered: false };
  await expect(
    sendBuildSteer(
      { db: w.s.db, hub: w.s.hub, user: w.s.user },
      'build',
      { content: TEXT },
      { afterTurn: true, human: false, schedule: wake },
    ),
  ).rejects.toThrow('Conversation phase cannot accept a continuation');
  expect(copies(w)).toEqual([]);
  expect(stepStatuses(w)).toEqual(['stopped']);
});

test.each(Object.keys(stops) as (keyof typeof stops)[])(
  'a message held by a Stop %s can be sent now',
  async (stopped) => {
    const w = await runningTask();
    stops[stopped](w);
    expect((await w.send({ content: TEXT, mode: 'queue', clientMessageId: KEY })).status).toBe(201);
    await userStop(w);
    const [row] = w.s.db.select().from(queuedMessage).all();
    expect((await w.send({ content: TEXT, queuedMessageId: row!.id })).status).toBe(201);
    expect(copies(w)).toEqual(['build']);
    expect(willReachTheAgent(w)).toBe(true);
  },
);

test.each(Object.keys(stops) as (keyof typeof stops)[])(
  'a new message queued after a Stop %s reaches the agent',
  async (stopped) => {
    const w = await runningTask();
    stops[stopped](w);
    await userStop(w);
    expect((await w.send({ content: TEXT, mode: 'queue', clientMessageId: KEY })).status).toBe(201);
    expect(copies(w)).toEqual(['build']);
    expect(willReachTheAgent(w)).toBe(true);
  },
);

test('a stop-and-send resend of a message held by a Stop delivers it', async () => {
  const w = await runningTask();
  expect((await w.send({ content: TEXT, mode: 'queue', clientMessageId: KEY })).status).toBe(201);
  await userStop(w);
  const again = await w.send({
    content: TEXT,
    mode: 'queue',
    deliverAfterStop: true,
    clientMessageId: KEY,
  });
  expect(again.status).toBe(201);
  expect(copies(w)).toEqual(['build']);
  expect(w.s.db.select().from(queuedMessage).all()).toHaveLength(0);
  expect(willReachTheAgent(w)).toBe(true);
});

test('a never received message addressed to the run before a retry reaches the new run', async () => {
  const w = await runningTask();
  expect((await w.finish('failed')).status).toBe(200);
  expect((await req(w.s.app, 'POST', '/api/builds/build/retry-now', {})).status).toBe(202);
  const next = latestBuild(w);
  expect(next).not.toBe('build');
  for (const _attempt of [1, 2]) {
    const sent = await w.send({ content: TEXT, mode: 'queue', clientMessageId: KEY });
    expect(sent.status).toBe(201);
    expect(await sent.json()).toMatchObject({ conversationId: next });
  }
  expect(copies(w)).toEqual([next]);
});

test('a message addressed to the conversation of another task is not forwarded', async () => {
  const w = await runningTask();
  const res = await req(w.s.app, 'POST', '/api/conversations/nowhere/messages', {
    content: TEXT,
    mode: 'queue',
    clientMessageId: KEY,
  });
  expect(res.status).toBe(404);
  expect(copies(w)).toEqual([]);
});

test.each([
  ['archived', 'reply', { archivedAt: 3 }, 'task-archived'],
  ['archived', 'queue', { archivedAt: 3 }, 'task-archived'],
  ['closed', 'queue', { phase: 'closed' as const }, 'task-closed'],
] as const)(
  'a send to a task that is %s names why through the %s route',
  async (_, route, patch, reason) => {
    const w = await runningTask();
    w.s.db.update(todo).set(patch).where(eq(todo.id, 'task')).run();
    const res = await routes[route](w);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason });
  },
);

test.each([
  ['queue', 'reply'],
  ['reply', 'queue'],
] as const)(
  'concurrent resends through the %s and %s routes deliver one copy while the send is slow',
  async (first, second) => {
    let probes = 0;
    const w = await runningTask({
      githubFetch: async () => {
        probes += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return Response.json({ state: 'open', merged: false });
      },
    });
    const task = w.s.db.select().from(todo).where(eq(todo.id, 'task')).get()!;
    w.s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'demo-owner/demo-repo' })
      .where(eq(project.id, task.projectId))
      .run();
    expect((await w.send({ content: TEXT, mode: 'queue', clientMessageId: KEY })).status).toBe(201);
    expect((await w.finish('failed')).status).toBe(200);
    w.s.db
      .update(build)
      .set({ prNumber: 43, prUrl: 'https://github.com/demo-owner/demo-repo/pull/43' })
      .where(eq(build.id, 'build'))
      .run();
    const before = probes;
    const leading = routes[first](w);
    await vi.waitFor(() => expect(probes).toBeGreaterThan(before));
    const answers = await Promise.all([leading, routes[second](w)]);
    expect(answers.map((res) => res.status)).toEqual([201, 201]);
    expect(copies(w)).toHaveLength(1);
    expect(w.s.db.select().from(step).where(eq(step.status, 'pending')).all()).toHaveLength(1);
  },
);
