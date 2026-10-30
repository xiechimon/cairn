import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import {
  build,
  machine as machineTable,
  message,
  step,
  stopPending,
  todo,
} from '../src/db/schema.js';
import { failStepWithEvents } from '../src/services/builds.js';
import { bootServer, issueApiKey, postProject, req } from './helpers.js';

async function runningTask() {
  const s = bootServer();
  const projectId = await postProject(s.app);
  s.db
    .insert(todo)
    .values({
      id: 'task',
      teamId: s.team.id,
      projectId,
      title: 'Queue test',
      phase: 'building',
      phaseAt: 1,
      seqNum: 1,
      latestBuildId: 'build',
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'build',
      todoId: 'task',
      withPlan: false,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt: 1,
      changes: [],
    })
    .run();
  const key = await issueApiKey(s);
  const enrolled = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'queue-machine', cliVersion: '0.1.0' }),
  });
  const machine = (await enrolled.json()) as { machineId: string; token: string };
  s.db
    .insert(step)
    .values({
      id: 'running',
      buildId: 'build',
      kind: 'build',
      status: 'claimed',
      machineId: machine.machineId,
      sessionId: 'builder-session',
      createdAt: 2,
      claimedAt: 2,
    })
    .run();
  const send = (body: object) => req(s.app, 'POST', '/api/conversations/build/messages', body);
  const face = async () =>
    (await req(s.app, 'GET', '/api/conversations/build/messages')).json() as Promise<{
      messages: { id: string; content: unknown }[];
      steerPending: string[];
      queuedMessages?: { id: string; content: string }[];
    }>;
  const finish = (status: 'success' | 'stopped' | 'failed') =>
    s.app.request('/api/machine/done/running', {
      method: 'POST',
      headers: { authorization: `Bearer ${machine.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status, sessionId: 'builder-session', hasChanges: true }),
    });
  return { s, send, face, finish };
}

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
  expect(w.s.db.select().from(step).all()).toMatchObject([
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
  expect(w.s.db.select().from(step).all()).toHaveLength(1);
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
