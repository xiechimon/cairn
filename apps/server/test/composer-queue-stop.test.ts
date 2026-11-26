import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import {
  build,
  machine as machineTable,
  message,
  project,
  step,
  stopPending,
  todo,
} from '../src/db/schema.js';
import { failStepWithEvents } from '../src/services/builds.js';
import { req } from './helpers.js';
import { runningTask } from './running-task.js';

test.each(['success', 'stopped', 'manual'] as const)(
  'correlates %s queue delivery with its source capsule without consuming equal text',
  async (kind) => {
    const w = await runningTask();
    const frames: object[] = [];
    const stop = w.s.convHub.subscribe('build', {
      nextSeq: () => 1,
      send: async (payload) => {
        frames.push(payload);
      },
    });
    await w.send({ content: 'Identical words', mode: 'queue', deliverAfterStop: true });
    await w.send({ content: 'Identical words', mode: 'queue' });
    const [first, keep] = (await w.face()).queuedMessages!;
    if (kind === 'manual')
      expect(
        (await w.send({ content: 'Identical words', queuedMessageId: first!.id })).status,
      ).toBe(201);
    else expect((await w.finish(kind)).status).toBe(200);
    expect(frames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message',
          message: expect.objectContaining({ role: 'user', content: 'Identical words' }),
          deliveredQueue: { conversationId: 'build', messageId: first!.id },
        }),
      ]),
    );
    expect((await w.face()).queuedMessages).toEqual([keep]);
    expect(
      (await w.face()).messages.filter((row) => row.content === 'Identical words'),
    ).toHaveLength(1);
    stop();
  },
);

test('a queued message reaches the stream with the key it was sent under', async () => {
  const w = await runningTask();
  const frames: object[] = [];
  const stop = w.s.convHub.subscribe('build', {
    nextSeq: () => 1,
    send: async (payload) => {
      frames.push(payload);
    },
  });
  await w.send({ content: 'Keyed turn', mode: 'queue', clientMessageId: 'key-from-the-page' });
  expect(frames).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: expect.objectContaining({ content: 'Keyed turn' }),
        clientMessageId: 'key-from-the-page',
      }),
    ]),
  );
  stop();
});

const copiesOf = async (w: Awaited<ReturnType<typeof runningTask>>, text: string) => {
  const face = await w.face();
  return [...face.messages, ...(face.queuedMessages ?? [])].filter((row) => row.content === text)
    .length;
};

test.each(['reply first', 'queue first'] as const)(
  'one typed message resent through the other route stays one message (%s)',
  async (order) => {
    const w = await runningTask();
    const key = 'one-typed-message';
    const reply = () =>
      req(w.s.app, 'POST', '/api/todos/task/messages', {
        content: 'Say it once',
        clientMessageId: key,
      });
    const queue = () => w.send({ content: 'Say it once', mode: 'queue', clientMessageId: key });
    const [first, second] = order === 'reply first' ? [reply, queue] : [queue, reply];
    expect((await first()).status).toBe(201);
    const again = await second();
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ conversationId: 'build' });
    expect(await copiesOf(w, 'Say it once')).toBe(1);
  },
);

test('a queued send that starts a new turn is reported as one by the other route', async () => {
  const w = await runningTask();
  expect((await w.finish('success')).status).toBe(200);
  const typed = { content: 'Next round', clientMessageId: 'idle-queue' };
  expect((await w.send({ ...typed, mode: 'queue' })).status).toBe(201);
  const again = await req(w.s.app, 'POST', '/api/todos/task/messages', typed);
  expect(await again.json()).toEqual({
    todoId: 'task',
    conversationId: 'build',
    delivered: 'new-turn',
  });
  expect(await copiesOf(w, 'Next round')).toBe(1);
});

test('one typed message that reaches both routes at once stays one message', async () => {
  const w = await runningTask();
  const key = 'raced';
  const answers = await Promise.all([
    req(w.s.app, 'POST', '/api/todos/task/messages', { content: 'Race', clientMessageId: key }),
    w.send({ content: 'Race', mode: 'queue', clientMessageId: key }),
  ]);
  expect(answers.map((answer) => answer.status)).toEqual([201, 201]);
  expect(await copiesOf(w, 'Race')).toBe(1);
});

test('resending a queued message as stop-and-send makes it run after the stop', async () => {
  const w = await runningTask();
  const typed = { content: 'Now this one', mode: 'queue', clientMessageId: 'upgrade' };
  await w.send(typed);
  expect((await w.send({ ...typed, deliverAfterStop: true })).status).toBe(201);
  expect((await w.face()).queuedMessages).toMatchObject([{ deliverAfterStop: true }]);
  expect(await copiesOf(w, 'Now this one')).toBe(1);
});

test('queued text persists without steering and completion starts exactly one continuation', async () => {
  const w = await runningTask();
  expect((await w.send({ content: 'Next turn', mode: 'queue' })).status).toBe(201);
  expect(await w.face()).toMatchObject({
    steerPending: [],
    queuedMessages: [{ content: 'Next turn' }],
  });
  expect(w.s.db.select().from(step).all()).toHaveLength(1);
  expect((await w.finish('success')).status).toBe(200);
  expect((await w.finish('success')).status).toBe(200);
  expect(w.s.db.select().from(step).where(eq(step.buildId, 'build')).all()).toMatchObject([
    { id: 'running', status: 'done' },
    { kind: 'build', status: 'pending', prompt: 'Next turn', freshSession: false },
  ]);
  expect(await w.face()).toMatchObject({ queuedMessages: [], steerPending: [] });
  expect(w.s.db.select().from(message).where(eq(message.content, 'Next turn')).all()).toHaveLength(
    1,
  );
});

test('steer now consumes the queued bubble once and does not start a later turn', async () => {
  const w = await runningTask();
  await w.send({ content: 'Steer this', mode: 'queue' });
  const queued = (await w.face()).queuedMessages?.[0];
  expect(queued).toBeDefined();
  expect((await w.send({ content: 'Steer this', queuedMessageId: queued?.id })).status).toBe(201);
  expect(await w.face()).toMatchObject({ queuedMessages: [], steerPending: ['Steer this'] });
  expect((await w.send({ content: 'Steer this', queuedMessageId: queued?.id })).status).toBe(409);
  await w.finish('success');
  expect(w.s.db.select().from(step).where(eq(step.buildId, 'build')).all()).toHaveLength(1);
  expect(w.s.db.select().from(step).where(eq(step.kind, 'chief')).all()).toHaveLength(1);
});

test('plain send still steers immediately', async () => {
  const w = await runningTask();
  await w.send({ content: 'Plain Enter' });
  expect(await w.face()).toMatchObject({ steerPending: ['Plain Enter'] });
});

test('stop preserves changes and a queued draft continues after the stopped acknowledgement', async () => {
  const w = await runningTask();
  expect((await req(w.s.app, 'POST', '/api/builds/build/stop', { discard: false })).status).toBe(
    202,
  );
  expect(w.s.db.select().from(stopPending).get()).toMatchObject({
    stepId: 'running',
    discard: false,
  });
  await w.send({ content: 'Draft after stop', mode: 'queue', deliverAfterStop: true });
  expect(w.s.db.select().from(step).all()).toHaveLength(1);
  expect((await w.finish('stopped')).status).toBe(200);
  expect(w.s.db.select().from(step).all()).toMatchObject([
    { status: 'stopped' },
    { status: 'pending', prompt: 'Draft after stop' },
  ]);
  expect(w.s.db.select().from(build).get()?.changes).toEqual([]);
});

test('obsolete and archived tasks reject queueing without persisting a message', async () => {
  const w = await runningTask();
  w.s.db.update(todo).set({ archivedAt: 3 }).where(eq(todo.id, 'task')).run();
  expect((await w.send({ content: 'Do not queue', mode: 'queue' })).status).toBe(409);
  w.s.db
    .update(todo)
    .set({ archivedAt: null, latestBuildId: 'newer' })
    .where(eq(todo.id, 'task'))
    .run();
  expect((await w.send({ content: 'Do not queue', mode: 'queue' })).status).toBe(409);
  expect(w.s.db.select().from(message).all()).toHaveLength(0);
});

test('a stopped planning turn continues planning instead of starting execution', async () => {
  const w = await runningTask();
  w.s.db.update(step).set({ kind: 'plan' }).where(eq(step.id, 'running')).run();
  w.s.db.update(todo).set({ phase: 'planning' }).where(eq(todo.id, 'task')).run();
  await w.send({ content: 'Revise the plan next', mode: 'queue', deliverAfterStop: true });
  expect((await w.finish('stopped')).status).toBe(200);
  expect(w.s.db.select().from(step).all()).toMatchObject([
    { kind: 'plan', status: 'stopped' },
    { kind: 'plan', status: 'pending', prompt: 'Revise the plan next' },
  ]);
});

test('a delivered turn still parked in building accepts its queued continuation', async () => {
  const w = await runningTask();
  await w.send({ content: 'Next delivery', mode: 'queue' });
  w.s.db.update(step).set({ status: 'done' }).where(eq(step.id, 'running')).run();
  expect((await w.finish('success')).status).toBe(200);
  expect(w.s.db.select().from(step).all()).toMatchObject([
    { status: 'done' },
    { kind: 'build', status: 'pending', prompt: 'Next delivery' },
  ]);
});

test('Stop leaves earlier queued messages queued', async () => {
  const w = await runningTask();
  await w.send({ content: 'A', mode: 'queue' });
  await req(w.s.app, 'POST', '/api/builds/build/stop', { discard: false });
  await w.finish('stopped');
  expect(w.s.db.select().from(step).all()).toHaveLength(1);
  expect(await w.face()).toMatchObject({ queuedMessages: [{ content: 'A' }] });
});

test('only the stop draft resumes after Stop with an earlier queue', async () => {
  const w = await runningTask();
  await w.send({ content: 'A', mode: 'queue' });
  await req(w.s.app, 'POST', '/api/builds/build/stop', { discard: false });
  await w.send({ content: 'B', mode: 'queue', deliverAfterStop: true });
  await w.finish('stopped');
  await w.finish('stopped');
  expect(w.s.db.select().from(step).all()).toMatchObject([
    { status: 'stopped' },
    { status: 'pending', prompt: 'B' },
  ]);
  expect(await w.face()).toMatchObject({ queuedMessages: [{ content: 'A' }] });
});

test('failed steps keep queued messages cancellable without starting another turn', async () => {
  const w = await runningTask();
  await w.send({ content: 'A', mode: 'queue' });
  await w.finish('failed');
  expect(w.s.db.select().from(step).all()).toHaveLength(1);
  const queued = (await w.face()).queuedMessages![0]!;
  expect(
    (await w.send({ content: 'A', queuedMessageId: queued.id, cancelQueued: true })).status,
  ).toBe(201);
  expect(await w.face()).toMatchObject({ queuedMessages: [] });
});

test('rejected draining records the reason and allows cancellation on archived tasks', async () => {
  const w = await runningTask();
  await w.send({ content: 'A', mode: 'queue' });
  w.s.db.update(todo).set({ archivedAt: 3 }).where(eq(todo.id, 'task')).run();
  await w.finish('success');
  const queued = (await w.face()).queuedMessages![0]!;
  expect(queued).toMatchObject({ error: 'Task cannot accept a message' });
  expect(
    (await w.send({ content: 'A', queuedMessageId: queued.id, cancelQueued: true })).status,
  ).toBe(201);
  expect(await w.face()).toMatchObject({ queuedMessages: [] });
});

test('concurrent steering of the same queued message succeeds once', async () => {
  const w = await runningTask();
  await w.send({ content: 'A', mode: 'queue' });
  const queued = (await w.face()).queuedMessages![0]!;
  const responses = await Promise.all([
    w.send({ content: 'A', queuedMessageId: queued.id }),
    w.send({ content: 'A', queuedMessageId: queued.id }),
  ]);
  expect(responses.map((response) => response.status)).toEqual([201, 201]);
  expect(w.s.db.select().from(message).where(eq(message.content, 'A')).all()).toHaveLength(1);
});

test('editing a queued message rewrites it in place without duplicating or reordering', async () => {
  const w = await runningTask();
  await w.send({ content: 'A', mode: 'queue' });
  await w.send({ content: 'B', mode: 'queue' });
  const [first] = (await w.face()).queuedMessages!;
  const edited = await w.send({
    content: 'A edited',
    queuedMessageId: first!.id,
    editQueued: true,
  });
  expect(edited.status).toBe(201);
  expect(await w.face()).toMatchObject({
    queuedMessages: [{ id: first!.id, content: 'A edited' }, { content: 'B' }],
  });
});

test('editing a queued message that was already dispatched is rejected and does not resurrect it', async () => {
  const w = await runningTask();
  await w.send({ content: 'A', mode: 'queue' });
  const queued = (await w.face()).queuedMessages![0]!;
  await w.finish('success');
  expect(await w.face()).toMatchObject({ queuedMessages: [] });
  const edited = await w.send({
    content: 'A edited',
    queuedMessageId: queued.id,
    editQueued: true,
  });
  expect(edited.status).toBe(409);
  expect(await w.face()).toMatchObject({ queuedMessages: [] });
  expect(w.s.db.select().from(message).where(eq(message.content, 'A edited')).all()).toHaveLength(
    0,
  );
  expect(w.s.db.select().from(message).where(eq(message.content, 'A')).all()).toHaveLength(1);
});

test('claim failures outside finishStep leave the queue cancellable', async () => {
  const w = await runningTask();
  await w.send({ content: 'A', mode: 'queue' });
  const running = w.s.db.select().from(step).where(eq(step.id, 'running')).get()!;
  failStepWithEvents(w.s.svc, running, 'Machine unavailable');
  expect(w.s.db.select().from(step).all()).toMatchObject([{ status: 'failed' }]);
  const queued = (await w.face()).queuedMessages![0]!;
  expect(
    (await w.send({ content: 'A', queuedMessageId: queued.id, cancelQueued: true })).status,
  ).toBe(201);
  expect(await w.face()).toMatchObject({ queuedMessages: [] });
});

test('a synchronous Stop does not drain the earlier queue', async () => {
  const w = await runningTask();
  await w.send({ content: 'A', mode: 'queue' });
  w.s.db.update(step).set({ status: 'pending' }).where(eq(step.id, 'running')).run();
  expect((await req(w.s.app, 'POST', '/api/builds/build/stop', { discard: false })).status).toBe(
    200,
  );
  expect(w.s.db.select().from(step).all()).toMatchObject([{ status: 'stopped' }]);
  expect(await w.face()).toMatchObject({ queuedMessages: [{ content: 'A' }] });
});

test('idle discard is rejected without changing earlier rounds', async () => {
  const w = await runningTask();
  const machineId = w.s.db.select().from(step).get()!.machineId!;
  w.s.db.update(machineTable).set({ online: true }).where(eq(machineTable.id, machineId)).run();
  const commands: unknown[] = [];
  w.s.machineHub.subscribeMachine(w.s.team.id, machineId, (event) => commands.push(event));
  const changes = [{ path: 'earlier-round.ts', additions: 1, deletions: 0, hunks: [] }];
  w.s.db
    .update(build)
    .set({ baseSha: 'a'.repeat(40), changes })
    .where(eq(build.id, 'build'))
    .run();
  await req(w.s.app, 'POST', '/api/builds/build/stop', { discard: false });
  await w.finish('stopped');
  const response = await req(w.s.app, 'POST', '/api/builds/build/stop', { discard: true });
  expect(response.status).toBe(409);
  expect(commands.filter((event) => (event as { type: string }).type === 'sync')).toEqual([]);
  expect(w.s.db.select().from(build).get()?.changes).toEqual(changes);
  expect(w.s.db.select().from(step).all()).toHaveLength(1);
});

test.each(['success', 'stopped', 'manual', 'local'] as const)(
  'a %s rollover confirms delivery to the source subscription and carries the remaining queue',
  async (kind) => {
    let pullState = 'open';
    const w = await runningTask({
      githubFetch: async () => Response.json({ state: pullState, merged: false }),
    });
    const task = w.s.db.select().from(todo).where(eq(todo.id, 'task')).get()!;
    w.s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'demo-owner/demo-repo' })
      .where(eq(project.id, task.projectId))
      .run();
    w.s.db
      .update(build)
      .set({ prNumber: 43, prUrl: 'https://github.com/demo-owner/demo-repo/pull/43' })
      .where(eq(build.id, 'build'))
      .run();
    expect(
      (await w.send({ content: 'A', mode: 'queue', deliverAfterStop: kind === 'stopped' })).status,
    ).toBe(201);
    expect((await w.send({ content: 'B', mode: 'queue' })).status).toBe(201);
    const [queuedA, queuedB] = (await w.face()).queuedMessages!;
    if (kind === 'local') {
      w.s.db
        .update(project)
        .set({ repoKind: 'local', githubRepo: null })
        .where(eq(project.id, task.projectId))
        .run();
      w.s.db
        .insert(step)
        .values({
          id: 'landed-merge',
          buildId: 'build',
          kind: 'merge',
          status: 'done',
          checkpointCommit: 'a'.repeat(40),
          createdAt: 1,
        })
        .run();
    }
    const frames: object[] = [];
    const stopSource = w.s.convHub.subscribe('build', {
      nextSeq: () => 1,
      send: async (frame) => {
        frames.push(frame);
      },
    });
    const published = vi.spyOn(w.s.convHub, 'publishMessage');
    pullState = 'closed';
    if (kind === 'manual') {
      w.s.db.update(step).set({ status: 'done' }).where(eq(step.id, 'running')).run();
      w.s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, 'task')).run();
      expect((await w.send({ content: 'A', queuedMessageId: queuedA!.id })).status).toBe(201);
    } else expect((await w.finish(kind === 'stopped' ? 'stopped' : 'success')).status).toBe(200);
    const newBuildId = w.s.db.select().from(todo).where(eq(todo.id, 'task')).get()!.latestBuildId!;
    expect(newBuildId).not.toBe('build');
    expect(w.s.convHub.subscriberCount(newBuildId)).toBe(0);
    expect(frames.filter((frame) => (frame as { type: string }).type === 'message')).toEqual([
      ...(kind === 'success' || kind === 'local'
        ? [
            {
              type: 'message',
              message: expect.objectContaining({ role: 'system', content: '🎉 任务已完成' }),
            },
          ]
        : []),
      {
        type: 'message',
        conversationId: newBuildId,
        message: expect.objectContaining({ role: 'user', content: 'A' }),
        deliveredQueue: { conversationId: 'build', messageId: queuedA!.id },
      },
    ]);
    stopSource();
    expect(published).toHaveBeenCalledWith(
      newBuildId,
      expect.objectContaining({ role: 'user', content: 'A' }),
      { conversationId: 'build', messageId: queuedA!.id },
    );
    const response = await req(w.s.app, 'GET', `/api/conversations/${newBuildId}/messages`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'A' })]),
      queuedMessages: [{ ...queuedB, conversationId: newBuildId }],
      steerPending: [],
    });
    expect(await w.face()).toMatchObject({ queuedMessages: [] });
    expect(w.s.db.select().from(message).where(eq(message.content, 'A')).all()).toHaveLength(1);
    const next = w.s.db.select().from(step).where(eq(step.buildId, newBuildId)).get()!;
    expect(next).toMatchObject({ status: 'pending', prompt: 'A' });
    const machineId = w.s.db.select().from(step).where(eq(step.id, 'running')).get()!.machineId;
    w.s.db
      .update(step)
      .set({ status: 'claimed', machineId, sessionId: 'builder-session', claimedAt: 3 })
      .where(eq(step.id, next.id))
      .run();
    w.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, 'task')).run();
    const finished = await w.finish('success', next.id);
    expect(finished.status, JSON.stringify(await finished.json())).toBe(200);
    expect(w.s.db.select().from(step).where(eq(step.buildId, newBuildId)).all()).toMatchObject([
      { id: next.id, status: 'done', prompt: 'A' },
      { status: 'pending', prompt: 'B' },
    ]);
    expect(w.s.db.select().from(message).where(eq(message.content, 'B')).all()).toHaveLength(1);
    const finalResponse = await req(w.s.app, 'GET', `/api/conversations/${newBuildId}/messages`);
    expect(await finalResponse.json()).toMatchObject({ queuedMessages: [] });
  },
);
