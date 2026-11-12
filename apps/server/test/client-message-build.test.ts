import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import {
  build,
  message,
  project,
  queuedMessage,
  steerPending,
  step,
  todo,
} from '../src/db/schema.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

interface Sent {
  conversationId: string;
  message: { id: string; content: string };
  delivered?: 'steer' | 'new-turn';
}

type StepStatus = (typeof step.$inferSelect)['status'];

async function world(opts: Parameters<typeof bootServer>[0] = {}) {
  const s = bootServer(opts);
  const projectId = await postProject(s.app);
  return { s, projectId };
}

function seedTask(
  s: TestServer,
  projectId: string,
  id: string,
  phase: 'building' | 'done',
  stepStatus: StepStatus,
) {
  s.db
    .insert(todo)
    .values({
      id: `todo-${id}`,
      teamId: s.team.id,
      projectId,
      title: `Task ${id}`,
      phase,
      phaseAt: 1,
      seqNum: id === 'one' ? 1 : 2,
      latestBuildId: `build-${id}`,
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: `build-${id}`,
      todoId: `todo-${id}`,
      withPlan: false,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt: 1,
      changes: [],
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: `step-${id}`,
      buildId: `build-${id}`,
      kind: 'build',
      status: stepStatus,
      sessionId: 'builder-session',
      createdAt: 1,
    })
    .run();
}

async function send(s: TestServer, id: string, body: Record<string, unknown>) {
  const res = await req(s.app, 'POST', `/api/conversations/build-${id}/messages`, body);
  return { status: res.status, body: (await res.json()) as Sent };
}

const messagesOf = (s: TestServer, id: string, content: string) =>
  s.db
    .select()
    .from(message)
    .where(eq(message.conversationId, `build-${id}`))
    .all()
    .filter((row) => row.content === content);

const stepsOf = (s: TestServer, id: string) =>
  s.db
    .select()
    .from(step)
    .where(eq(step.buildId, `build-${id}`))
    .all();

describe('steering a running task with a client message id', () => {
  async function running() {
    const w = await world();
    seedTask(w.s, w.projectId, 'one', 'building', 'claimed');
    return w;
  }

  test('the same key twice is one message and one steer with the original response', async () => {
    const { s } = await running();
    const signal = vi.spyOn(s.machineHub, 'steerSignal');
    const first = await send(s, 'one', { content: 'steer', clientMessageId: 'key-1' });
    const second = await send(s, 'one', { content: 'steer', clientMessageId: 'key-1' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(first.body.delivered).toBe('steer');
    expect(messagesOf(s, 'one', 'steer')).toHaveLength(1);
    expect(signal).toHaveBeenCalledTimes(1);
  });

  test('different keys are two messages', async () => {
    const { s } = await running();
    await send(s, 'one', { content: 'steer', clientMessageId: 'key-1' });
    await send(s, 'one', { content: 'steer', clientMessageId: 'key-2' });
    expect(messagesOf(s, 'one', 'steer')).toHaveLength(2);
  });

  test('a missing clientMessageId is rejected and writes nothing', async () => {
    const { s } = await running();
    const res = await s.app.request('/api/conversations/build-one/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cairn-raw-send': '1' },
      body: JSON.stringify({ content: 'steer' }),
    });
    expect(res.status).toBe(400);
    expect(messagesOf(s, 'one', 'steer')).toEqual([]);
  });

  test('a key reused with different content returns the ORIGINAL response and stores nothing new', async () => {
    const { s } = await running();
    const first = await send(s, 'one', { content: 'original', clientMessageId: 'key-1' });
    const second = await send(s, 'one', { content: 'edited', clientMessageId: 'key-1' });
    expect(second.body.message.id).toBe(first.body.message.id);
    expect(second.body.message.content).toBe('original');
    expect(messagesOf(s, 'one', 'edited')).toHaveLength(0);
    expect(s.db.select().from(steerPending).get()?.content).toBe('original');
  });

  test('the same key on two conversations is independent', async () => {
    const { s, projectId } = await running();
    seedTask(s, projectId, 'two', 'building', 'claimed');
    await send(s, 'one', { content: 'steer', clientMessageId: 'key-1' });
    await send(s, 'two', { content: 'steer', clientMessageId: 'key-1' });
    expect(messagesOf(s, 'one', 'steer')).toHaveLength(1);
    expect(messagesOf(s, 'two', 'steer')).toHaveLength(1);
  });

  test('a replay publishes no second conversation event', async () => {
    const { s } = await running();
    const publish = vi.spyOn(s.convHub, 'publishMessage');
    await send(s, 'one', { content: 'steer', clientMessageId: 'key-1' });
    const afterFirst = publish.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    await send(s, 'one', { content: 'steer', clientMessageId: 'key-1' });
    expect(publish.mock.calls).toHaveLength(afterFirst);
  });

  test('a first attempt rolled back inside the transaction leaves no ledger row for the retry', async () => {
    const { s } = await running();
    vi.spyOn(s.machineHub, 'steerSignal').mockImplementationOnce(() => {
      throw new Error('signal failed');
    });
    const failed = await req(s.app, 'POST', '/api/conversations/build-one/messages', {
      content: 'steer',
      clientMessageId: 'key-1',
    });
    expect(failed.status).not.toBe(201);
    expect(messagesOf(s, 'one', 'steer')).toHaveLength(0);
    const retry = await send(s, 'one', { content: 'steer', clientMessageId: 'key-1' });
    expect(retry.status).toBe(201);
    expect(messagesOf(s, 'one', 'steer')).toHaveLength(1);
  });
});

describe('continuing a finished task with a client message id', () => {
  async function finished() {
    const w = await world();
    seedTask(w.s, w.projectId, 'one', 'done', 'done');
    return w;
  }

  test('the same key twice is one message and one new step', async () => {
    const { s } = await finished();
    const first = await send(s, 'one', { content: 'next turn', clientMessageId: 'key-1' });
    const second = await send(s, 'one', { content: 'next turn', clientMessageId: 'key-1' });
    expect(second.body).toEqual(first.body);
    expect(first.body.delivered).toBe('new-turn');
    expect(messagesOf(s, 'one', 'next turn')).toHaveLength(1);
    expect(stepsOf(s, 'one').filter((row) => row.status === 'pending')).toHaveLength(1);
  });

  test('a replay after the new step was claimed does not start another turn or steer', async () => {
    const { s } = await finished();
    await send(s, 'one', { content: 'next turn', clientMessageId: 'key-1' });
    const pending = stepsOf(s, 'one').find((row) => row.status === 'pending');
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: Date.now() })
      .where(eq(step.id, pending?.id ?? ''))
      .run();
    const signal = vi.spyOn(s.machineHub, 'steerSignal');
    const replay = await send(s, 'one', { content: 'next turn', clientMessageId: 'key-1' });
    expect(replay.status).toBe(201);
    expect(signal).not.toHaveBeenCalled();
    expect(s.db.select().from(steerPending).all()).toHaveLength(0);
    expect(stepsOf(s, 'one')).toHaveLength(2);
    expect(messagesOf(s, 'one', 'next turn')).toHaveLength(1);
  });

  test('a concurrent duplicate that passed the pre-check hits the unique key, rolls back and returns the stored response', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let probes = 0;
    const { s, projectId } = await world({
      githubFetch: async () => {
        probes += 1;
        await gate;
        return Response.json({ state: 'open', merged: false });
      },
    });
    seedTask(s, projectId, 'one', 'done', 'done');
    s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'demo-owner/demo-repo' })
      .where(eq(project.id, projectId))
      .run();
    s.db.update(build).set({ prNumber: 43 }).where(eq(build.id, 'build-one')).run();
    const both = Promise.all([
      send(s, 'one', { content: 'next turn', clientMessageId: 'key-1' }),
      send(s, 'one', { content: 'next turn', clientMessageId: 'key-1' }),
    ]);
    await vi.waitFor(() => expect(probes).toBe(2));
    release();
    const [first, second] = await both;
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.message.id).toBe(first.body.message.id);
    expect(messagesOf(s, 'one', 'next turn')).toHaveLength(1);
    expect(stepsOf(s, 'one').filter((row) => row.status === 'pending')).toHaveLength(1);
  });
});

describe('queueing a message with a client message id', () => {
  async function running() {
    const w = await world();
    seedTask(w.s, w.projectId, 'one', 'building', 'claimed');
    return w;
  }

  test('the same key twice is one queued message and no step', async () => {
    const { s } = await running();
    const publish = vi.spyOn(s.convHub, 'publishMessage');
    const first = await send(s, 'one', {
      content: 'later',
      mode: 'queue',
      clientMessageId: 'key-1',
    });
    const afterFirst = publish.mock.calls.length;
    const second = await send(s, 'one', {
      content: 'later',
      mode: 'queue',
      clientMessageId: 'key-1',
    });
    expect(second.body).toEqual(first.body);
    expect(s.db.select().from(queuedMessage).all()).toHaveLength(1);
    expect(stepsOf(s, 'one')).toHaveLength(1);
    expect(publish.mock.calls).toHaveLength(afterFirst);
  });

  test('different keys are two queued messages', async () => {
    const { s } = await running();
    await send(s, 'one', { content: 'later', mode: 'queue', clientMessageId: 'key-1' });
    await send(s, 'one', { content: 'later', mode: 'queue', clientMessageId: 'key-2' });
    expect(s.db.select().from(queuedMessage).all()).toHaveLength(2);
  });

  test('a missing clientMessageId is rejected and queues nothing', async () => {
    const { s } = await running();
    const res = await s.app.request('/api/conversations/build-one/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cairn-raw-send': '1' },
      body: JSON.stringify({ content: 'later', mode: 'queue' }),
    });
    expect(res.status).toBe(400);
    expect(s.db.select().from(queuedMessage).all()).toEqual([]);
  });

  test('a key reused with different content returns the ORIGINAL queued message', async () => {
    const { s } = await running();
    const first = await send(s, 'one', {
      content: 'original',
      mode: 'queue',
      clientMessageId: 'k',
    });
    const second = await send(s, 'one', { content: 'edited', mode: 'queue', clientMessageId: 'k' });
    expect(second.body.message.id).toBe(first.body.message.id);
    expect(
      s.db
        .select()
        .from(queuedMessage)
        .all()
        .map((row) => row.content),
    ).toEqual(['original']);
  });

  test('queue mode on an idle task falls through to one new turn for a repeated key', async () => {
    const w = await world();
    seedTask(w.s, w.projectId, 'one', 'done', 'done');
    const body = { content: 'idle', mode: 'queue', clientMessageId: 'key-1' };
    const first = await send(w.s, 'one', body);
    const second = await send(w.s, 'one', body);
    expect(second.body).toEqual(first.body);
    expect(messagesOf(w.s, 'one', 'idle')).toHaveLength(1);
    expect(stepsOf(w.s, 'one').filter((row) => row.status === 'pending')).toHaveLength(1);
  });
});
