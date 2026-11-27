import { conversationMessagesResponseSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  build,
  chief,
  chiefMessage,
  chiefThread,
  message,
  project,
  queuedMessage,
  step,
  todo,
} from '../src/db/schema.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { sendBuildSteer } from '../src/services/builds.js';
import { submitChiefMessage } from '../src/services/chief.js';
import { deliverQueuedMessage, queueTaskMessage } from '../src/services/task-message-queue.js';
import { messageThreadAsUser } from '../src/services/thread-message.js';
import { bootServer, insertMachine, postProject, req, seedRoute } from './helpers.js';

async function createWorld() {
  const s = bootServer({
    githubFetch: async () => Response.json({ state: 'closed', merged: false }),
  });
  const projectId = await postProject(s.app, 'demo');
  seedRoute(s, 'coordinator', { id: 'agent-chief-1', provider: 'stub-gw', modelId: 'stub-model' });
  insertMachine(s);
  const chiefId = `chief-${s.user.id}-${s.team.id}`;
  const threadId = `chief-${newUuidv7()}`;
  const now = nowMs();
  s.db
    .insert(chief)
    .values({
      id: chiefId,
      userId: s.user.id,
      teamId: s.team.id,
      watches: [],
      wakes: [],
      createdAt: now,
    })
    .run();
  s.db
    .insert(chiefThread)
    .values({
      id: threadId,
      chiefId,
      userId: s.user.id,
      teamId: s.team.id,
      title: 'Coordinator thread',
      createdAt: now,
      updatedAt: now,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: now,
      toolDefHashes: {},
      toolResultHashes: {},
    })
    .run();
  return { s, projectId, threadId };
}

function seedTaskWorld(
  s: ReturnType<typeof bootServer>,
  projectId: string,
  opts: { id?: string; buildId?: string; phase?: 'building' | 'done' | 'confirm' | 'failed' } = {},
) {
  const id = opts.id ?? 'todo-cm-1';
  const buildId = opts.buildId ?? 'build-cm-1';
  const phase = opts.phase ?? 'done';
  s.db
    .insert(todo)
    .values({
      id,
      projectId,
      teamId: s.team.id,
      title: 'ClientMessageId coverage',
      phase,
      phaseAt: 1,
      seqNum: 99,
      latestBuildId: buildId,
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: buildId,
      todoId: id,
      withPlan: false,
      triggerSource: 'user',
      createdAt: 1,
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: `step-${id}`,
      buildId,
      kind: 'build',
      status: phase === 'building' ? 'claimed' : phase === 'failed' ? 'failed' : 'done',
      createdAt: 1,
    })
    .run();
}

describe('persisted clientMessageId across message, queued_message, and chief_message', () => {
  test('task steer, new-turn, and restart persist clientMessageId and return it in messages response', async () => {
    const { s, projectId } = await createWorld();
    seedTaskWorld(s, projectId, { phase: 'building' });
    const first = await req(s.app, 'POST', '/api/todos/todo-cm-1/messages', {
      content: 'steer key one',
      clientMessageId: 'cm-steer-1',
    });
    expect(first.status).toBe(201);

    const listRes = await req(s.app, 'GET', '/api/conversations/build-cm-1/messages');
    expect(listRes.status).toBe(200);
    const parsed = conversationMessagesResponseSchema.parse(await listRes.json());
    expect(parsed.messages.find((m) => m.content === 'steer key one')).toMatchObject({
      role: 'user',
      clientMessageId: 'cm-steer-1',
    });

    s.db.update(step).set({ status: 'done' }).where(eq(step.id, 'step-todo-cm-1')).run();
    s.db.update(todo).set({ phase: 'failed' }).where(eq(todo.id, 'todo-cm-1')).run();
    const restart = await req(s.app, 'POST', '/api/todos/todo-cm-1/messages', {
      content: 'restart key two',
      clientMessageId: 'cm-restart-2',
    });
    expect(restart.status).toBe(201);
    const latestTodo = s.db.select().from(todo).where(eq(todo.id, 'todo-cm-1')).get();
    const afterRestart = conversationMessagesResponseSchema.parse(
      await (
        await req(s.app, 'GET', `/api/conversations/${latestTodo?.latestBuildId}/messages`)
      ).json(),
    );
    expect(afterRestart.messages.find((m) => m.content === 'restart key two')).toMatchObject({
      role: 'user',
      clientMessageId: 'cm-restart-2',
    });
  }, 30_000);

  test('queueTaskMessage and deliverQueuedMessage preserve clientMessageId across drain and rollover', async () => {
    const { s, projectId } = await createWorld();
    s.db.update(project).set({ repoKind: 'local' }).where(eq(project.id, projectId)).run();
    s.db
      .insert(todo)
      .values({
        id: 'todo-q-1',
        projectId,
        teamId: s.team.id,
        title: 'Queued rollover',
        phase: 'building',
        phaseAt: 1,
        seqNum: 100,
        latestBuildId: 'build-q-1',
      })
      .run();
    s.db
      .insert(build)
      .values({
        id: 'build-q-1',
        todoId: 'todo-q-1',
        withPlan: false,
        triggerSource: 'user',
        createdAt: 1,
      })
      .run();
    s.db
      .insert(step)
      .values({
        id: 'step-q-1',
        buildId: 'build-q-1',
        kind: 'build',
        status: 'claimed',
        createdAt: 1,
      })
      .run();

    const queued = await queueTaskMessage(s.svc, 'build-q-1', 'queued msg', true, 'cm-queue-1');
    expect('message' in queued).toBe(true);
    const secondQueued = await queueTaskMessage(
      s.svc,
      'build-q-1',
      'rollover survivor',
      false,
      'cm-queue-2',
    );
    const stranded = await queueTaskMessage(
      s.svc,
      'build-q-1',
      'stranded msg',
      false,
      'cm-queue-3',
    );
    expect('message' in stranded).toBe(true);

    const whileQueued = conversationMessagesResponseSchema.parse(
      await (await req(s.app, 'GET', '/api/conversations/build-q-1/messages')).json(),
    );
    expect(whileQueued.queuedMessages).toMatchObject([
      { content: 'queued msg', clientMessageId: 'cm-queue-1' },
      { content: 'rollover survivor', clientMessageId: 'cm-queue-2' },
      { content: 'stranded msg', clientMessageId: 'cm-queue-3' },
    ]);

    s.db.update(step).set({ status: 'done' }).where(eq(step.id, 'step-q-1')).run();
    s.db
      .insert(step)
      .values({
        id: 'step-merge-q-1',
        buildId: 'build-q-1',
        kind: 'merge',
        status: 'done',
        checkpointCommit: 'abc1234',
        createdAt: 2,
      })
      .run();
    s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, 'todo-q-1')).run();
    const q1Id = (queued as { message: { id: string } }).message.id;
    const delivered = await deliverQueuedMessage(s.svc, 'build-q-1', q1Id, false);
    const rolledBuildId =
      typeof delivered === 'object' &&
      delivered !== null &&
      'conversationId' in delivered &&
      typeof delivered.conversationId === 'string'
        ? delivered.conversationId
        : undefined;
    if (rolledBuildId === undefined) throw new Error('expected rollover build id');
    expect(rolledBuildId).not.toBe('build-q-1');

    const rolledRes = conversationMessagesResponseSchema.parse(
      await (await req(s.app, 'GET', `/api/conversations/${rolledBuildId}/messages`)).json(),
    );
    expect(rolledRes.messages.find((m) => m.content === 'queued msg')).toMatchObject({
      role: 'user',
      clientMessageId: 'cm-queue-1',
    });
    expect(secondQueued).toBeDefined();
    expect(
      s.db
        .select()
        .from(queuedMessage)
        .where(eq(queuedMessage.conversationId, rolledBuildId))
        .all()
        .map((row) => ({ content: row.content, clientMessageId: row.clientMessageId })),
    ).toEqual([
      { content: 'rollover survivor', clientMessageId: 'cm-queue-2' },
      { content: 'stranded msg', clientMessageId: 'cm-queue-3' },
    ]);

    s.db.update(step).set({ status: 'done' }).where(eq(step.buildId, rolledBuildId)).run();
    s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, 'todo-q-1')).run();
    const replaced = await queueTaskMessage(
      s.svc,
      rolledBuildId,
      'stranded msg',
      false,
      'cm-queue-3',
    );
    expect(replaced).toBeDefined();
    const afterReplace = conversationMessagesResponseSchema.parse(
      await (await req(s.app, 'GET', `/api/conversations/${rolledBuildId}/messages`)).json(),
    );
    expect(afterReplace.messages.find((m) => m.content === 'stranded msg')).toMatchObject({
      role: 'user',
      clientMessageId: 'cm-queue-3',
    });

    s.db
      .insert(todo)
      .values({
        id: 'todo-rev-1',
        projectId,
        teamId: s.team.id,
        title: 'Confirm revision',
        phase: 'confirm',
        phaseAt: 1,
        seqNum: 101,
        latestBuildId: 'build-rev-1',
      })
      .run();
    s.db
      .insert(build)
      .values({
        id: 'build-rev-1',
        todoId: 'todo-rev-1',
        withPlan: true,
        triggerSource: 'user',
        createdAt: 1,
      })
      .run();
    s.db
      .insert(step)
      .values({
        id: 'step-rev-1',
        buildId: 'build-rev-1',
        kind: 'plan',
        status: 'done',
        createdAt: 1,
      })
      .run();
    const revRes = await req(s.app, 'POST', '/api/todos/todo-rev-1/messages', {
      content: 'revise plan step',
      clientMessageId: 'cm-rev-1',
    });
    expect(revRes.status).toBe(201);
    const revList = conversationMessagesResponseSchema.parse(
      await (await req(s.app, 'GET', '/api/conversations/build-rev-1/messages')).json(),
    );
    expect(revList.messages.find((m) => m.content === 'revise plan step')).toMatchObject({
      role: 'user',
      clientMessageId: 'cm-rev-1',
    });
  }, 30_000);

  test('chief_message persists clientMessageId, omits null legacy keys, and blocks nested ledger leaks', async () => {
    const { s, projectId, threadId } = await createWorld();
    const sent = submitChiefMessage(s.svc, s.team.id, {
      threadId,
      content: 'chief turn one',
      clientMessageId: 'cm-chief-1',
    });
    expect(sent.result.message).toMatchObject({ clientMessageId: 'cm-chief-1' });

    s.db
      .insert(chiefMessage)
      .values({
        id: 'legacy-chief-msg',
        threadId,
        role: 'user',
        content: 'legacy pre-migration',
        projectId: null,
        origin: 'user',
        clientMessageId: null,
        createdAt: 1,
      })
      .run();

    const chiefList = (await (
      await req(s.app, 'GET', `/api/conversations/${threadId}/messages`)
    ).json()) as { messages: Record<string, unknown>[] };
    expect(chiefList.messages.find((m) => m.content === 'chief turn one')).toMatchObject({
      clientMessageId: 'cm-chief-1',
    });
    const legacyChief = chiefList.messages.find((m) => m.id === 'legacy-chief-msg');
    expect(legacyChief).toBeDefined();
    expect(Object.hasOwn(legacyChief ?? {}, 'clientMessageId')).toBe(false);

    seedTaskWorld(s, projectId, { phase: 'building' });
    await messageThreadAsUser(
      s.svc,
      s.team.id,
      'todo-cm-1',
      { content: 'synthetic relay', clientMessageId: 'cm-coord-relay' },
      { origin: 'coordinator', actor: 'Coordinator' },
    );
    const syntheticRow = s.db
      .select()
      .from(message)
      .where(eq(message.content, 'synthetic relay'))
      .get();
    expect(syntheticRow?.clientMessageId).toBeNull();

    const steerNoKey = await sendBuildSteer(
      s.svc,
      'build-cm-1',
      { content: 'daemon steer without client key' },
      { human: true },
    );
    expect(steerNoKey.delivered).toBe('steer');
    const noKeyRow = s.db
      .select()
      .from(message)
      .where(eq(message.content, 'daemon steer without client key'))
      .get();
    expect(noKeyRow?.clientMessageId).toBeNull();
  }, 30_000);
});
