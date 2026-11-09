import Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect, onTestFinished, test, vi } from 'vitest';
import { migrateDatabase } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import {
  build,
  clientMessage,
  message,
  project,
  queuedMessage,
  step,
  todo,
} from '../src/db/schema.js';
import { applyBuildStepAction, sendBuildSteer } from '../src/services/builds.js';
import { drainTaskMessageQueue } from '../src/services/task-message-queue.js';
import { bootServer, postProject, req, seedRoute } from './helpers.js';

async function taskWorld(opts: Parameters<typeof bootServer>[0] = {}) {
  const s = bootServer({
    ...opts,
    githubFetch: async () => Response.json({ state: 'closed', merged: false }),
  });
  const projectId = await postProject(s.app);
  s.db
    .insert(todo)
    .values({
      id: 'task',
      projectId,
      teamId: s.team.id,
      title: 'Commit before confirming',
      phase: 'done',
      phaseAt: 1,
      seqNum: 1,
      latestBuildId: 'build',
    })
    .run();
  s.db
    .insert(build)
    .values({ id: 'build', todoId: 'task', withPlan: false, triggerSource: 'user', createdAt: 1 })
    .run();
  s.db
    .insert(step)
    .values({ id: 'previous', buildId: 'build', kind: 'build', status: 'done', createdAt: 1 })
    .run();
  const frames: object[] = [];
  s.convHub.subscribe('build', {
    nextSeq: () => 1,
    send: async (frame) => {
      frames.push(frame);
    },
  });
  const published = vi.spyOn(s.convHub, 'publishMessage');
  return { s, projectId, frames, published };
}

test.each(['steer', 'thread', 'continuation', 'manual', 'automatic', 'stop', 'rollover'] as const)(
  '%s rollback after inserting the message emits no confirmation and preserves a retry',
  async (kind) => {
    const { s, projectId, frames, published } = await taskWorld();
    const queued = ['manual', 'automatic', 'stop', 'rollover'].includes(kind);
    if (queued)
      s.db
        .insert(queuedMessage)
        .values({
          id: 'capsule',
          conversationId: 'build',
          content: 'Keep this message',
          createdAt: 1,
          deliverAfterStop: kind === 'stop',
        })
        .run();
    if (kind === 'stop')
      s.db.update(step).set({ status: 'stopped' }).where(eq(step.id, 'previous')).run();
    if (kind === 'steer' || kind === 'thread') {
      s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, 'previous')).run();
      s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, 'task')).run();
    }
    if (kind === 'rollover') {
      s.db
        .update(project)
        .set({ repoKind: 'github', githubRepo: 'demo-owner/demo-repo' })
        .where(eq(project.id, projectId))
        .run();
      s.db.update(build).set({ prNumber: 43 }).where(eq(build.id, 'build')).run();
    }
    const fail =
      kind === 'steer' || kind === 'thread'
        ? vi.spyOn(s.machineHub, 'steerSignal')
        : vi.spyOn(s.machineHub, 'wake');
    fail.mockImplementationOnce(() => {
      throw new Error('post-insert failure');
    });
    const body = {
      content: 'Keep this message',
      clientMessageId: 'same-key',
      ...(queued ? { queuedMessageId: 'capsule' } : {}),
    };
    const attempt = () =>
      kind === 'thread'
        ? req(s.app, 'POST', '/api/todos/task/messages', body)
        : kind === 'automatic' || kind === 'stop'
          ? drainTaskMessageQueue(s.svc, 'build')
          : sendBuildSteer(
              {
                ...s.svc,
                githubFetch: async () => Response.json({ state: 'closed', merged: false }),
              },
              'build',
              body,
              { human: true, afterTurn: true },
            );
    if (kind === 'thread') expect(((await attempt()) as Response).status).toBe(500);
    else await expect(attempt()).rejects.toThrow('post-insert failure');
    expect(s.db.select().from(message).where(eq(message.role, 'user')).all()).toEqual([]);
    expect(s.db.select().from(clientMessage).all()).toEqual([]);
    expect(s.db.select().from(queuedMessage).all()).toHaveLength(queued ? 1 : 0);
    expect(s.db.select().from(build).all()).toHaveLength(1);
    expect(published.mock.calls.filter(([, row]) => row.role === 'user')).toEqual([]);
    expect(
      frames.filter(
        (frame) => (frame as { type: string; message?: { role: string } }).message?.role === 'user',
      ),
    ).toEqual([]);
    await attempt();
    expect(s.db.select().from(message).where(eq(message.role, 'user')).all()).toHaveLength(1);
    expect(s.db.select().from(queuedMessage).all()).toEqual([]);
    expect(published.mock.calls.filter(([, row]) => row.role === 'user')).toHaveLength(1);
    if (kind === 'rollover')
      expect(frames).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'message',
            deliveredQueue: { conversationId: 'build', messageId: 'capsule' },
          }),
        ]),
      );
  },
);

test.each(['new', 'reuse'] as const)(
  'a %s-build restart does not confirm rolled-back feedback',
  async (kind) => {
    const { s, published } = await taskWorld();
    s.db.update(todo).set({ phase: 'failed' }).where(eq(todo.id, 'task')).run();
    s.db
      .update(step)
      .set({ status: 'failed', ...(kind === 'reuse' ? { checkpointCommit: 'a'.repeat(40) } : {}) })
      .where(eq(step.id, 'previous'))
      .run();
    vi.spyOn(s.machineHub, 'wake').mockImplementationOnce(() => {
      throw new Error('post-insert failure');
    });
    const restart = () =>
      applyBuildStepAction(s.svc, 'build', {
        action: 'restart',
        feedback: 'Keep this feedback',
        clientMessageId: 'same-key',
      });
    await expect(restart()).rejects.toThrow('post-insert failure');
    expect(s.db.select().from(message).all()).toEqual([]);
    expect(published.mock.calls.filter(([, row]) => row.role === 'user')).toEqual([]);
    await restart();
    expect(s.db.select().from(message).where(eq(message.role, 'user')).all()).toHaveLength(1);
    expect(published.mock.calls.filter(([, row]) => row.role === 'user')).toHaveLength(1);
  },
);

test('the user event is published outside the transaction after the capsule and ledger commit', async () => {
  const sqlite = new Database(':memory:');
  onTestFinished(() => {
    sqlite.close();
  });
  const db = drizzle(sqlite, { schema });
  migrateDatabase(sqlite, db);
  const { s } = await taskWorld({ db });
  s.db
    .insert(queuedMessage)
    .values({ id: 'capsule', conversationId: 'build', content: 'Committed', createdAt: 1 })
    .run();
  const snapshots: { inTransaction: boolean; queue: number; completed: boolean; steps: number }[] =
    [];
  s.convHub.subscribe('build', {
    nextSeq: () => 1,
    send: async (frame) => {
      if ((frame as { message?: { role: string } }).message?.role !== 'user') return;
      snapshots.push({
        inTransaction: sqlite.inTransaction,
        queue: s.db.select().from(queuedMessage).all().length,
        completed: s.db.select().from(clientMessage).get()?.response != null,
        steps: s.db.select().from(step).all().length,
      });
    },
  });
  await sendBuildSteer(
    s.svc,
    'build',
    { content: 'Committed', queuedMessageId: 'capsule', clientMessageId: 'committed-key' },
    { human: true },
  );
  expect(snapshots).toEqual([{ inTransaction: false, queue: 0, completed: true, steps: 2 }]);
});

test('a final ledger failure rolls back queue consumption without publishing delivery', async () => {
  const { s, published } = await taskWorld();
  s.db
    .insert(queuedMessage)
    .values({ id: 'capsule', conversationId: 'build', content: 'Keep queued', createdAt: 1 })
    .run();
  s.db.run(
    sql`CREATE TRIGGER reject_ledger BEFORE UPDATE ON client_message BEGIN SELECT RAISE(ABORT, 'ledger failure'); END`,
  );
  const body = {
    content: 'Keep queued',
    queuedMessageId: 'capsule',
    clientMessageId: 'ledger-key',
  };
  await expect(sendBuildSteer(s.svc, 'build', body, { human: true })).rejects.toThrow();
  expect(s.db.select().from(message).where(eq(message.role, 'user')).all()).toEqual([]);
  expect(s.db.select().from(queuedMessage).all()).toHaveLength(1);
  expect(s.db.select().from(clientMessage).all()).toEqual([]);
  expect(s.db.select().from(step).all()).toHaveLength(1);
  expect(published.mock.calls.filter(([, row]) => row.role === 'user')).toEqual([]);
  s.db.run(sql`DROP TRIGGER reject_ledger`);
  await sendBuildSteer(s.svc, 'build', body, { human: true });
  expect(s.db.select().from(queuedMessage).all()).toEqual([]);
  expect(published.mock.calls.filter(([, row]) => row.role === 'user')).toHaveLength(1);
});

test('queue creation rolls back without a capsule event when completing its ledger fails', async () => {
  const { s, published } = await taskWorld();
  s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, 'previous')).run();
  s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, 'task')).run();
  s.db.run(
    sql`CREATE TRIGGER reject_ledger BEFORE UPDATE ON client_message BEGIN SELECT RAISE(ABORT, 'post-insert failure'); END`,
  );
  const body = { content: 'Queued after commit', mode: 'queue', clientMessageId: 'queue-key' };
  expect((await req(s.app, 'POST', '/api/conversations/build/messages', body)).status).toBe(500);
  expect(s.db.select().from(queuedMessage).all()).toEqual([]);
  expect(published.mock.calls.filter(([, row]) => row.role === 'user')).toEqual([]);
  s.db.run(sql`DROP TRIGGER reject_ledger`);
  expect((await req(s.app, 'POST', '/api/conversations/build/messages', body)).status).toBe(201);
  expect(published.mock.calls.filter(([, row]) => row.role === 'user')).toHaveLength(1);
});

test.each(['confirm', 'review'] as const)(
  'a %s revision publishes feedback that is already persisted',
  async (phase) => {
    const { s } = await taskWorld();
    s.db.update(todo).set({ phase }).where(eq(todo.id, 'task')).run();
    const persisted: boolean[] = [];
    s.convHub.subscribe('build', {
      nextSeq: () => 1,
      send: async (frame) => {
        const event = frame as { message?: { id: string; role: string } };
        if (event.message?.role === 'user')
          persisted.push(
            s.db.select().from(message).where(eq(message.id, event.message.id)).get() !== undefined,
          );
      },
    });
    await applyBuildStepAction(s.svc, 'build', {
      action: 'revision',
      side: 'plan',
      feedback: 'Persist revision feedback',
      clientMessageId: 'revision-key',
    });
    expect(persisted).toEqual([true]);
  },
);

test('Coordinator submission rolls back without a user event when step creation fails', async () => {
  const s = bootServer();
  seedRoute(s, 'coordinator');
  const published = vi.spyOn(s.convHub, 'publishMessage');
  vi.spyOn(s.machineHub, 'wake').mockImplementationOnce(() => {
    throw new Error('post-insert failure');
  });
  const path = `/api/teams/${s.team.id}/chief/threads`;
  const body = { content: 'Coordinator commit check', clientMessageId: 'chief-key' };
  expect((await req(s.app, 'POST', path, body)).status).toBe(500);
  expect(s.db.select().from(clientMessage).all()).toEqual([]);
  expect(published.mock.calls.filter(([, row]) => row.role === 'user')).toEqual([]);
  expect((await req(s.app, 'POST', path, body)).status).toBe(201);
  expect(published.mock.calls.filter(([, row]) => row.role === 'user')).toHaveLength(1);
});
