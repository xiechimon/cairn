import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { build, machine as machineTable, steerPending, step, todo } from '../src/db/schema.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

function seedClaimedTask(
  phase: 'building' | 'planning' = 'building',
  stepKind: 'session' | 'build' | 'plan' = 'session',
  ageMs = 0,
) {
  const now = Date.now() - ageMs;
  const machineRow = H.s.db.select().from(machineTable).get()!;
  H.s.db
    .insert(todo)
    .values({
      id: 'dead-todo',
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Dead turn task',
      phase,
      phaseAt: now,
      seqNum: 11,
      latestBuildId: 'dead-build',
    })
    .run();
  H.s.db
    .insert(build)
    .values({
      id: 'dead-build',
      todoId: 'dead-todo',
      withPlan: stepKind === 'plan',
      triggerSource: 'user',
      createdAt: now,
    })
    .run();
  H.s.db
    .insert(step)
    .values({
      id: 'dead-step',
      buildId: 'dead-build',
      kind: stepKind,
      status: 'claimed',
      machineId: machineRow.id,
      claimedAt: now,
      lastHeartbeatAt: now,
      createdAt: now,
    })
    .run();
  return machineRow;
}

describe('task thread dead-turn detection', () => {
  test('a claimed task turn that stopped heartbeating for >45s is ended on send and starts a new turn', async () => {
    seedClaimedTask('building', 'session', 60_000);
    const res = await req(H.s.app, 'POST', '/api/todos/dead-todo/messages', {
      content: '你还在跑吗',
      clientMessageId: 'dead-1',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      todoId: 'dead-todo',
      conversationId: 'dead-build',
      delivered: 'new-turn',
    });
    expect(H.s.db.select().from(step).where(eq(step.id, 'dead-step')).get()?.status).toBe(
      'stopped',
    );
    const next = H.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, 'dead-build'))
      .all()
      .find((row) => row.id !== 'dead-step');
    expect(next).toMatchObject({ kind: 'session', status: 'pending', prompt: '你还在跑吗' });
    expect(H.s.db.select().from(steerPending).all()).toEqual([]);
  });

  test('a claimed task turn on an offline machine is ended on send and starts a new turn', async () => {
    const m = seedClaimedTask('building', 'session', 0);
    H.s.db.update(machineTable).set({ online: false }).where(eq(machineTable.id, m.id)).run();
    const res = await req(H.s.app, 'POST', '/api/todos/dead-todo/messages', {
      content: '换一台继续',
      clientMessageId: 'dead-2',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ delivered: 'new-turn' });
    expect(H.s.db.select().from(step).where(eq(step.id, 'dead-step')).get()?.status).toBe(
      'stopped',
    );
    const next = H.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, 'dead-build'))
      .all()
      .find((row) => row.id !== 'dead-step');
    expect(next).toMatchObject({ status: 'pending', prompt: '换一台继续' });
  });

  test('a claimed task turn on a silent-since-drop machine is ended on send and starts a new turn', async () => {
    const m = seedClaimedTask('building', 'session', 0);
    vi.spyOn(H.s.machineHub, 'silentSinceDrop').mockImplementation((id) => id === m.id);
    const res = await req(H.s.app, 'POST', '/api/conversations/dead-build/messages', {
      content: '通道断了直接重开',
      clientMessageId: 'dead-3',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ delivered: 'new-turn' });
    expect(H.s.db.select().from(step).where(eq(step.id, 'dead-step')).get()?.status).toBe(
      'stopped',
    );
    const next = H.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, 'dead-build'))
      .all()
      .find((row) => row.id !== 'dead-step');
    expect(next).toMatchObject({ status: 'pending', prompt: '通道断了直接重开' });
  });

  test('a claimed planning turn on a dead runner ends and starts a new plan turn', async () => {
    seedClaimedTask('planning', 'plan', 60_000);
    const res = await req(H.s.app, 'POST', '/api/todos/dead-todo/messages', {
      content: '重新规划',
      clientMessageId: 'dead-4',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ delivered: 'new-turn' });
    expect(H.s.db.select().from(step).where(eq(step.id, 'dead-step')).get()?.status).toBe(
      'stopped',
    );
    const next = H.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, 'dead-build'))
      .all()
      .find((row) => row.id !== 'dead-step');
    expect(next).toMatchObject({ kind: 'plan', status: 'pending', prompt: '重新规划' });
  });

  test('a claimed task turn that is still heartbeating is steered, not ended', async () => {
    seedClaimedTask('building', 'session', 5_000);
    const res = await req(H.s.app, 'POST', '/api/todos/dead-todo/messages', {
      content: '顺便改下标题',
      clientMessageId: 'alive-1',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ delivered: 'steer' });
    expect(H.s.db.select().from(step).where(eq(step.id, 'dead-step')).get()?.status).toBe(
      'claimed',
    );
    expect(H.s.db.select().from(steerPending).get()?.content).toBe('顺便改下标题');
  });
});
