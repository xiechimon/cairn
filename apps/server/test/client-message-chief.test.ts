import { and, eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import {
  build,
  chiefMessage,
  clientMessage,
  coordinatorInput,
  message,
  step,
  todo,
} from '../src/db/schema.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

interface Sent {
  thread: { id: string };
  message: { id: string; content: string };
}

const entryPoints = [
  ['POST /coordinator/messages', () => `/api/teams/${H.teamId}/coordinator/messages`],
  ['POST /chief/threads', () => `/api/teams/${H.teamId}/chief/threads`],
  ['POST /conversations/:chiefThread/messages', () => `/api/conversations/${H.threadId}/messages`],
] as const;

function userMessages() {
  return H.s.db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.threadId, H.threadId), eq(chiefMessage.role, 'user')))
    .all();
}

function chiefSteps() {
  return H.s.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, H.threadId), eq(step.kind, 'chief')))
    .all();
}

async function post(url: string, body: Record<string, unknown>) {
  const res = await req(H.s.app, 'POST', url, body);
  return { status: res.status, body: (await res.json()) as Sent };
}

describe.each(entryPoints)('%s with a client message id', (_name, urlOf) => {
  test('the same key twice is one message and one step with the original response', async () => {
    const first = await post(urlOf(), { content: 'hello', clientMessageId: 'key-1' });
    const second = await post(urlOf(), { content: 'hello', clientMessageId: 'key-1' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.message).toEqual(first.body.message);
    expect(second.body.thread.id).toBe(H.threadId);
    expect(userMessages()).toHaveLength(1);
    expect(chiefSteps()).toHaveLength(1);
  });

  test('different keys are two messages and two steps', async () => {
    await post(urlOf(), { content: 'hello', clientMessageId: 'key-1' });
    await post(urlOf(), { content: 'hello', clientMessageId: 'key-2' });
    expect(userMessages()).toHaveLength(2);
    expect(chiefSteps()).toHaveLength(2);
  });

  test('a missing clientMessageId is rejected and writes nothing', async () => {
    const res = await H.s.app.request(urlOf(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cairn-raw-send': '1' },
      body: JSON.stringify({ content: 'hello' }),
    });
    expect(res.status).toBe(400);
    expect(userMessages()).toEqual([]);
    expect(chiefSteps()).toEqual([]);
  });

  test('a key reused with different content returns the ORIGINAL response and stores nothing new', async () => {
    const first = await post(urlOf(), { content: 'original text', clientMessageId: 'key-1' });
    const second = await post(urlOf(), { content: 'edited text', clientMessageId: 'key-1' });
    expect(second.body.message.id).toBe(first.body.message.id);
    expect(second.body.message.content).toBe('original text');
    expect(userMessages().map((row) => row.content)).toEqual(['original text']);
  });

  test('a replay publishes no second conversation event', async () => {
    const publish = vi.spyOn(H.s.convHub, 'publishMessage');
    await post(urlOf(), { content: 'hello', clientMessageId: 'key-1' });
    const afterFirst = publish.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    await post(urlOf(), { content: 'hello', clientMessageId: 'key-1' });
    expect(publish.mock.calls).toHaveLength(afterFirst);
  });

  test('a failed first attempt leaves no ledger row, so the retry with the same key succeeds', async () => {
    const wake = vi.spyOn(H.s.machineHub, 'wake').mockImplementationOnce(() => {
      throw new Error('wake failed');
    });
    const failed = await req(H.s.app, 'POST', urlOf(), {
      content: 'hello',
      clientMessageId: 'key-1',
    });
    expect(failed.status).not.toBe(201);
    expect(userMessages()).toHaveLength(0);
    expect(chiefSteps()).toHaveLength(0);
    wake.mockRestore();
    const retry = await post(urlOf(), { content: 'hello', clientMessageId: 'key-1' });
    expect(retry.status).toBe(201);
    expect(userMessages()).toHaveLength(1);
    expect(chiefSteps()).toHaveLength(1);
  });
});

describe('a replay while the original turn is already running', () => {
  test('does not steer again', async () => {
    await post(`/api/teams/${H.teamId}/coordinator/messages`, { content: 'earlier' });
    const [running] = chiefSteps();
    H.s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: Date.now() })
      .where(eq(step.id, running?.id ?? ''))
      .run();
    const signal = vi.spyOn(H.s.machineHub, 'steerSignal');
    const body = { content: 'steer me once', clientMessageId: 'key-1' };
    await post(`/api/teams/${H.teamId}/coordinator/messages`, body);
    expect(signal).toHaveBeenCalledTimes(1);
    const steered = H.s.db.select().from(coordinatorInput).get();
    expect(steered?.content).toBe('steer me once');
    await post(`/api/teams/${H.teamId}/coordinator/messages`, body);
    expect(signal).toHaveBeenCalledTimes(1);
    expect(H.s.db.select().from(coordinatorInput).all()).toEqual([steered]);
    expect(chiefSteps()).toHaveLength(2);
  });
});

describe('POST /api/todos/:id/messages with a client message id', () => {
  function seedThread(todoId: string, buildId: string) {
    H.s.db
      .insert(todo)
      .values({
        id: todoId,
        teamId: H.teamId,
        projectId: H.projectId,
        title: `Thread ${todoId}`,
        phase: 'building',
        phaseAt: 1,
        seqNum: todoId === 'todo-a' ? 7 : 8,
        latestBuildId: buildId,
      })
      .run();
    H.s.db
      .insert(build)
      .values({ id: buildId, todoId, withPlan: true, triggerSource: 'chief', createdAt: 1 })
      .run();
    H.s.db
      .insert(step)
      .values({
        id: `${buildId}-step`,
        buildId,
        kind: 'build',
        status: 'claimed',
        sessionId: 'worker-session',
        createdAt: 1,
      })
      .run();
  }

  const send = (todoId: string, body: Record<string, unknown>) =>
    req(H.s.app, 'POST', `/api/todos/${todoId}/messages`, body);

  function markers() {
    return H.s.db
      .select()
      .from(chiefMessage)
      .all()
      .filter((row) => String(row.content).includes('thread-message'));
  }

  function steered(buildId: string) {
    return H.s.db.select().from(message).where(eq(message.conversationId, buildId)).all();
  }

  test('the same key twice delivers once and records one Coordinator marker', async () => {
    seedThread('todo-a', 'build-a');
    const signal = vi.spyOn(H.s.machineHub, 'steerSignal');
    const publish = vi.spyOn(H.s.convHub, 'publishMessage');
    const first = await send('todo-a', { content: 'Use the index', clientMessageId: 'key-1' });
    const afterFirst = publish.mock.calls.length;
    const second = await send('todo-a', { content: 'Use the index', clientMessageId: 'key-1' });
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
    expect(steered('build-a')).toHaveLength(1);
    expect(signal).toHaveBeenCalledTimes(1);
    expect(markers()).toHaveLength(1);
    expect(publish.mock.calls).toHaveLength(afterFirst);
  });

  test('a concurrent duplicate delivers once', async () => {
    seedThread('todo-a', 'build-a');
    const [first, second] = await Promise.all([
      send('todo-a', { content: 'Use the index', clientMessageId: 'key-1' }),
      send('todo-a', { content: 'Use the index', clientMessageId: 'key-1' }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
    expect(steered('build-a')).toHaveLength(1);
    expect(markers()).toHaveLength(1);
  });

  test('a retry after a lost Coordinator marker does not deliver the message twice', async () => {
    seedThread('todo-a', 'build-a');
    await send('todo-a', { content: 'Use the index', clientMessageId: 'key-1' });
    H.s.db.delete(clientMessage).where(eq(clientMessage.scopeId, 'todo-a')).run();
    H.s.db.delete(chiefMessage).where(eq(chiefMessage.role, 'system')).run();
    const retry = await send('todo-a', { content: 'Use the index', clientMessageId: 'key-1' });
    expect(retry.status).toBe(201);
    expect(steered('build-a')).toHaveLength(1);
    expect(markers()).toHaveLength(1);
  });

  test('different keys deliver twice', async () => {
    seedThread('todo-a', 'build-a');
    await send('todo-a', { content: 'Use the index', clientMessageId: 'key-1' });
    await send('todo-a', { content: 'Use the index', clientMessageId: 'key-2' });
    expect(steered('build-a')).toHaveLength(2);
    expect(markers()).toHaveLength(2);
  });

  test('the same key in different threads is independent', async () => {
    seedThread('todo-a', 'build-a');
    seedThread('todo-b', 'build-b');
    await send('todo-a', { content: 'Use the index', clientMessageId: 'key-1' });
    await send('todo-b', { content: 'Use the index', clientMessageId: 'key-1' });
    expect(steered('build-a')).toHaveLength(1);
    expect(steered('build-b')).toHaveLength(1);
    expect(markers()).toHaveLength(2);
  });

  test('a rejected first attempt leaves no ledger row, so the retry succeeds', async () => {
    seedThread('todo-a', 'build-a');
    H.s.db.update(todo).set({ phase: 'queued' }).where(eq(todo.id, 'todo-a')).run();
    H.s.db.update(step).set({ status: 'done' }).run();
    const rejected = await send('todo-a', { content: 'Use the index', clientMessageId: 'key-1' });
    expect(rejected.status).toBe(409);
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, 'todo-a')).run();
    H.s.db.update(step).set({ status: 'claimed' }).run();
    const retry = await send('todo-a', { content: 'Use the index', clientMessageId: 'key-1' });
    expect(retry.status).toBe(201);
    expect(steered('build-a')).toHaveLength(1);
  });

  test('the same key as a Coordinator send is a different scope', async () => {
    seedThread('todo-a', 'build-a');
    await post(`/api/teams/${H.teamId}/coordinator/messages`, {
      content: 'coordinator text',
      clientMessageId: 'key-1',
    });
    await send('todo-a', { content: 'Use the index', clientMessageId: 'key-1' });
    expect(userMessages()).toHaveLength(1);
    expect(steered('build-a')).toHaveLength(1);
  });
});
