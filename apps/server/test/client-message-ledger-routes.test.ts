import { STOP_MESSAGE } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { build, clientMessage, message, step, todo } from '../src/db/schema.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

function seedGate(phase: 'confirm' | 'failed' | 'todo', buildId: string, todoId: string) {
  H.s.db
    .insert(todo)
    .values({
      id: todoId,
      teamId: H.teamId,
      projectId: H.projectId,
      title: phase,
      phase,
      phaseAt: 1,
      seqNum: 3,
      latestBuildId: buildId,
    })
    .run();
  H.s.db
    .insert(build)
    .values({
      id: buildId,
      todoId,
      withPlan: phase === 'confirm',
      triggerSource: 'user',
      ...(phase === 'todo' ? { errorMessage: STOP_MESSAGE } : {}),
      createdAt: 1,
    })
    .run();
  H.s.db
    .insert(step)
    .values({
      id: `${buildId}-step`,
      buildId,
      kind: phase === 'confirm' ? 'plan' : 'session',
      status: phase === 'todo' ? 'stopped' : 'done',
      createdAt: 1,
    })
    .run();
}

test('a retry of revision returns the stored response and does not apply twice', async () => {
  seedGate('confirm', 'gate-build', 'gate-todo');
  const body = {
    action: 'revision',
    side: 'plan',
    feedback: 'Split the migration out',
    clientMessageId: 'rev-1',
  };
  const first = await req(H.s.app, 'POST', '/api/builds/gate-build/steps', body);
  const second = await req(H.s.app, 'POST', '/api/builds/gate-build/steps', body);
  expect(first.status).toBe(202);
  expect(second.status).toBe(202);
  expect(await second.json()).toEqual(await first.json());
  expect(
    H.s.db
      .select()
      .from(step)
      .all()
      .filter((row) => row.status === 'pending'),
  ).toHaveLength(1);
  expect(
    H.s.db
      .select()
      .from(message)
      .all()
      .filter((row) => row.role === 'user'),
  ).toHaveLength(1);
});

test('a retry of restart returns the stored response and does not apply twice', async () => {
  seedGate('failed', 'restart-build', 'restart-todo');
  const body = {
    action: 'restart',
    feedback: 'Retry on the orb machine',
    clientMessageId: 'restart-1',
  };
  const first = await req(H.s.app, 'POST', '/api/builds/restart-build/steps', body);
  const second = await req(H.s.app, 'POST', '/api/builds/restart-build/steps', body);
  expect(first.status).toBe(202);
  expect(second.status).toBe(202);
  expect(await second.json()).toEqual(await first.json());
  expect(H.s.db.select().from(build).where(eq(build.todoId, 'restart-todo')).all()).toHaveLength(2);
});

test('a crashed start after a stop before the first run does not start another build', async () => {
  seedGate('todo', 'stopped-build', 'stopped-todo');
  H.s.db.run(
    sql`CREATE TRIGGER abort_stopped_phase BEFORE UPDATE OF phase ON todo BEGIN SELECT RAISE(ABORT, 'phase write failed'); END`,
  );
  const body = { content: 'Start again', clientMessageId: 'stopped-1' };
  const crashed = await req(H.s.app, 'POST', '/api/todos/stopped-todo/messages', body);
  H.s.db.run(sql`DROP TRIGGER abort_stopped_phase`);
  expect(crashed.status).not.toBe(201);
  const retry = await req(H.s.app, 'POST', '/api/todos/stopped-todo/messages', body);
  expect(retry.status).toBe(201);
  const again = await req(H.s.app, 'POST', '/api/todos/stopped-todo/messages', body);
  expect(await again.json()).toEqual(await retry.json());
  expect(H.s.db.select().from(build).where(eq(build.todoId, 'stopped-todo')).all()).toHaveLength(2);
});

test('a direct step receipt with the same key does not count as the thread send', async () => {
  seedGate('confirm', 'shared-build', 'shared-todo');
  H.s.db
    .insert(clientMessage)
    .values({
      scopeId: 'shared-build',
      clientMessageId: 'shared-1',
      response: { delegated: true, delivered: 'revision' },
      createdAt: 1,
    })
    .run();
  const sent = await req(H.s.app, 'POST', '/api/todos/shared-todo/messages', {
    content: 'Split the migration',
    clientMessageId: 'shared-1',
  });
  expect(sent.status).toBe(201);
  expect(
    H.s.db
      .select()
      .from(message)
      .all()
      .filter((row) => row.role === 'user')
      .map((row) => row.content),
  ).toEqual(['Split the migration']);
});
