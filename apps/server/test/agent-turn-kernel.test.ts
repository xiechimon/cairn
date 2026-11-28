import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  build,
  chief,
  chiefMessage,
  chiefThread,
  message,
  project,
  step,
  stopPending,
  todo,
} from '../src/db/schema.js';
import {
  agentTurnKind,
  emitTurnRow,
  emitTurnTextDelta,
  readTurnTranscriptContents,
  releaseStallRecoveryHold,
  settleCoordinatorTurn,
} from '../src/services/agent-turn-kernel.js';
import type { MachineDeps } from '../src/services/machine-deps.js';
import { bootServer } from './helpers.js';

function depsOf(s: ReturnType<typeof bootServer>): MachineDeps {
  return {
    db: s.db,
    hub: s.hub,
    convHub: s.convHub,
    machineHub: s.machineHub,
    box: s.secretBox,
    user: s.user,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
}

describe('agent-turn-kernel', () => {
  test('classifies coordinator and task turns uniformly', () => {
    expect(agentTurnKind({ kind: 'chief', buildId: 'chief-thread-1' })).toBe('coordinator');
    expect(agentTurnKind({ kind: 'chief', buildId: 'build-1' })).toBe('task');
    expect(agentTurnKind({ kind: 'build', buildId: 'build-1' })).toBe('task');
  });

  test('routes transcript rows, deltas, and reads through coordinator or task channels', () => {
    const s = bootServer();
    s.db
      .insert(chief)
      .values({ id: 'chief-1', userId: s.user.id, teamId: s.team.id, createdAt: 1 })
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: 'chief-t-1',
        chiefId: 'chief-1',
        userId: s.user.id,
        teamId: s.team.id,
        title: 't',
        createdAt: 1,
        updatedAt: 1,
        sessionId: 'chief-t-1',
        sessionOpenedAt: 1,
      })
      .run();
    s.db
      .insert(project)
      .values({
        id: 'proj-1',
        teamId: s.team.id,
        name: 'p',
        repoKind: 'local',
      })
      .run();
    s.db
      .insert(todo)
      .values({
        id: 'todo-1',
        teamId: s.team.id,
        projectId: 'proj-1',
        seqNum: 1,
        title: 't',
        phase: 'building',
        phaseAt: 1,
      })
      .run();
    s.db
      .insert(build)
      .values({
        id: 'build-1',
        todoId: 'todo-1',
        withPlan: false,
        triggerSource: 'user',
        createdAt: 1,
      })
      .run();

    s.db
      .insert(step)
      .values([
        {
          id: 'step-coord',
          buildId: 'chief-t-1',
          kind: 'chief',
          status: 'claimed',
          prompt: 'hi',
          createdAt: 1,
        },
        {
          id: 'step-task',
          buildId: 'build-1',
          kind: 'build',
          status: 'claimed',
          prompt: 'work',
          createdAt: 1,
        },
      ])
      .run();
    const coordStep = s.db.select().from(step).where(eq(step.id, 'step-coord')).get();
    const taskStep = s.db.select().from(step).where(eq(step.id, 'step-task')).get();
    if (!coordStep || !taskStep) throw new Error('missing seeded steps');

    const deps = depsOf(s);
    emitTurnTextDelta(deps, coordStep, 'hello ');
    emitTurnRow(
      deps,
      coordStep,
      { id: 'cm-1', role: 'assistant', content: 'coord reply', createdAt: 10 },
      { flushChiefShield: true },
    );

    emitTurnTextDelta(deps, taskStep, 'working ');
    emitTurnRow(deps, taskStep, {
      id: 'tm-1',
      role: 'assistant',
      content: 'task reply',
      createdAt: 10,
    });

    expect(readTurnTranscriptContents(s.db, coordStep)).toContain('coord reply');
    expect(readTurnTranscriptContents(s.db, taskStep)).toContain('task reply');
    expect(s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'cm-1')).get()).toBeDefined();
    expect(s.db.select().from(message).where(eq(message.id, 'tm-1')).get()).toBeDefined();
  });

  test('releases stall recovery hold only for matching owner and generation', () => {
    const s = bootServer();
    const deps = depsOf(s);
    s.db
      .insert(step)
      .values([
        {
          id: 'step-hold-server',
          buildId: 'chief-t-hold',
          kind: 'chief',
          status: 'pending',
          holdReason: 'stall_recovery',
          holdUntil: 99_999,
          claimedAt: 42,
          createdAt: 1,
          stallState: { lastRecoveredAt: 10, lastRecoveredFromMachineId: null },
        },
        {
          id: 'step-hold-daemon',
          buildId: 'build-hold',
          kind: 'build',
          status: 'pending',
          holdReason: 'stall_recovery',
          holdUntil: 99_999,
          claimedAt: 77,
          createdAt: 1,
          stallState: { lastRecoveredAt: 10, lastRecoveredFromMachineId: 'mach-1' },
        },
      ])
      .run();

    releaseStallRecoveryHold(deps, {
      stepId: 'step-hold-server',
      machineId: null,
      expectedGeneration: 999,
    });
    expect(s.db.select().from(step).where(eq(step.id, 'step-hold-server')).get()?.holdReason).toBe(
      'stall_recovery',
    );

    releaseStallRecoveryHold(deps, {
      stepId: 'step-hold-server',
      machineId: null,
      expectedGeneration: 42,
    });
    expect(
      s.db.select().from(step).where(eq(step.id, 'step-hold-server')).get()?.holdReason,
    ).toBeNull();

    releaseStallRecoveryHold(deps, {
      stepId: 'step-hold-daemon',
      machineId: 'mach-1',
      expectedGeneration: 77,
      requireRecoveredTimestamp: true,
      requireMachineOwner: true,
    });
    expect(
      s.db.select().from(step).where(eq(step.id, 'step-hold-daemon')).get()?.holdReason,
    ).toBeNull();
  });

  test('settleCoordinatorTurn settles chief turn and clears stopPending', () => {
    const s = bootServer();
    const deps = depsOf(s);
    s.db
      .insert(chief)
      .values({ id: 'chief-s', userId: s.user.id, teamId: s.team.id, createdAt: 1 })
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: 'chief-t-settle',
        chiefId: 'chief-s',
        userId: s.user.id,
        teamId: s.team.id,
        title: 'settle',
        createdAt: 1,
        updatedAt: 1,
        sessionId: 'chief-t-settle',
        sessionOpenedAt: 1,
      })
      .run();
    s.db
      .insert(step)
      .values({
        id: 'step-settle-1',
        buildId: 'chief-t-settle',
        kind: 'chief',
        status: 'claimed',
        machineId: null,
        createdAt: 1,
        claimedAt: 100,
        lastHeartbeatAt: 100,
        prompt: 'say ok',
      })
      .run();
    const row = s.db.select().from(step).where(eq(step.id, 'step-settle-1')).get();
    if (!row) throw new Error('missing settle step');
    s.db
      .insert(stopPending)
      .values({ stepId: row.id, conversationId: row.buildId, discard: true, createdAt: 50 })
      .run();

    const settled = settleCoordinatorTurn(
      deps,
      row,
      { status: 'success' },
      { recordUsage: true, clearStopPending: true, stopComputer: true },
    );

    expect(settled.fellBack).toBe(false);
    expect(s.db.select().from(step).where(eq(step.id, row.id)).get()?.status).toBe('done');
    expect(
      s.db.select().from(stopPending).where(eq(stopPending.stepId, row.id)).get(),
    ).toBeUndefined();
    expect(
      s.db.select().from(chiefThread).where(eq(chiefThread.id, 'chief-t-settle')).get()?.lastTurnAt,
    ).not.toBeNull();
  });
});
