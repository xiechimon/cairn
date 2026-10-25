import { type ClaimedStep, type Phase, STOP_MESSAGE } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  stopPending as stopPendingTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  cancelBuild,
  sweepAbandonedBuildSteps,
  sweepZombieQueuedTodos,
} from '../src/services/builds.js';
import { claimStep } from '../src/services/machines.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';
import { bindAllAgents, bootServer, type TestServer } from './helpers.js';

registerChiefHarness();

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

function machineDepsOf(s: TestServer) {
  return { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir };
}

function insertMachine(s: TestServer, id: string, opts: { cap?: number; online?: boolean } = {}) {
  s.db
    .insert(machineTable)
    .values({
      id,
      teamId: s.team.id,
      name: id,
      online: opts.online ?? true,
      maxConcurrent: opts.cap ?? 8,
      enabledRuntimes: ['pi'],
    })
    .run();
}

describe('#1219 the chief cancel -> re-dispatch chain', () => {
  test('cancel a queued build: the todo falls back + a later run_builds succeeds + the new step is claimed within seconds', async () => {
    insertMachine(H.s, 'machine-rerun');
    bindAllAgents(H.s, 'machine-rerun');
    const todoRec = (await relay('create_todo', {
      projectId: H.projectId,
      title: '被取消后重派',
      spec: 's',
    })) as { id: string };
    const started = (await relay('run_builds', {
      todoIds: [todoRec.id],
      assignment: { build: { agentId: AGENT_ID } },
    })) as { builds: { id: string }[] };
    const buildId = started.builds[0]!.id;

    const cancelled = (await relay('cancel_builds', { buildIds: [buildId] })) as {
      cancelled: string[];
    };
    expect(cancelled.cancelled).toEqual([buildId]);

    const stepRow = H.s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get()!;
    expect(stepRow.status).toBe('stopped');
    const todoRow = H.s.db.select().from(todoTable).where(eq(todoTable.id, todoRec.id)).get()!;
    expect(todoRow.phase).not.toBe('queued');
    const buildRow = H.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toBe(STOP_MESSAGE);

    const rerun = (await relay('run_builds', {
      todoIds: [todoRec.id],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
    })) as { builds: { id: string }[] };
    expect(rerun.builds).toHaveLength(1);

    const target = rerun.builds[0]!.id;
    let claimedTarget: ClaimedStep | null = null;
    for (let i = 0; i < 5 && claimedTarget === null; i++) {
      const c = await claimStep(
        machineDepsOf(H.s),
        'machine-rerun',
        H.s.team.id,
        10,
        'http://localhost',
      );
      if (c !== null && c.step.buildId === target) claimedTarget = c;
    }
    expect(claimedTarget).not.toBeNull();
  });

  test('cancel_builds cross-team / unknown build -> 404 (confirm/merge follow the same rule)', async () => {
    await expect(relay('cancel_builds', { buildIds: ['build-nope'] })).rejects.toThrow(
      'build build-nope',
    );
  });
});

describe('#1219 the cancelBuild funnel (claimed delegation / idempotent zombie release)', () => {
  interface World {
    s: TestServer;
    teamId: string;
    todoId: string;
    buildId: string;
    stepId: string;
    machineId: string;
    base: number;
  }
  function makeWorld(step: { status: 'pending' | 'claimed' | 'failed'; phase?: Phase }): World {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const base = Date.now();
    const teamId = s.team.id;
    const todoId = `todo-${Math.random().toString(36).slice(2)}`;
    const buildId = `build-${Math.random().toString(36).slice(2)}`;
    const stepId = `step-${Math.random().toString(36).slice(2)}`;
    const machineId = `machine-${Math.random().toString(36).slice(2)}`;
    s.db.insert(projectTable).values({ id: 'proj-c', name: 'cancel', teamId }).run();
    insertMachine(s, machineId);
    s.db
      .insert(agentTable)
      .values({
        id: 'agent-c',
        teamId,
        displayName: 'cancel-agent',
        provider: 'stub-gw',
        modelId: 'stub-model',
        machineId,
      })
      .run();
    s.db
      .insert(todoTable)
      .values({
        id: todoId,
        teamId,
        projectId: 'proj-c',
        title: 'cancel target',
        phase: step.phase ?? 'queued',
        phaseAt: base,
        seqNum: 1,
        assignment: { plan: { agentId: 'agent-c' }, build: { agentId: 'agent-c' } },
        latestBuildId: buildId,
      })
      .run();
    s.db
      .insert(buildTable)
      .values({
        id: buildId,
        todoId,
        withPlan: true,
        prevPhase: 'todo',
        triggerSource: 'chief',
        createdAt: base - 300_000,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: stepId,
        buildId,
        kind: 'plan',
        status: step.status,
        ...(step.status === 'claimed'
          ? { machineId, claimedAt: base - 300_000, lastHeartbeatAt: base - 100_000 }
          : {}),
        createdAt: base - 300_000,
      })
      .run();
    return { s, teamId, todoId, buildId, stepId, machineId, base };
  }

  test('a claimed step: the stop delegation surface (stopPending single slot + a machine stream stop event), the concurrency slot is not held dead', async () => {
    const w = makeWorld({ status: 'claimed' });
    const events: { type: string; stepId?: string }[] = [];
    w.s.machineHub.subscribe(w.teamId, (ev) => {
      if ('type' in ev) events.push(ev as { type: string; stepId?: string });
    });

    const out = cancelBuild(machineDepsOf(w.s), w.buildId);

    expect(out).toBe('delegated');
    const pending = w.s.db.select().from(stopPendingTable).all();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.stepId).toBe(w.stepId);
    expect(events.some((e) => e.type === 'stop')).toBe(true);
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    expect(stepRow.status).toBe('claimed');
  });

  test('no active step (zombie shape): idempotent release -- the todo leaves queued + errorMessage fallback + the event surface', () => {
    const w = makeWorld({ status: 'failed', phase: 'queued' });
    const buildBefore = w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()!;

    const out = cancelBuild(machineDepsOf(w.s), w.buildId);

    expect(out).toBe('released');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('todo');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()!;
    expect(buildRow.errorMessage).toBe(buildBefore.errorMessage ?? STOP_MESSAGE);
    expect(cancelBuild(machineDepsOf(w.s), w.buildId)).toBe('released');
    const todoRow2 = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow2.phase).toBe('todo');
  });

  test('no active step and the todo no longer queued (a terminal card): a no-op that changes no phase', () => {
    const w = makeWorld({ status: 'failed', phase: 'failed' });
    const out = cancelBuild(machineDepsOf(w.s), w.buildId);
    expect(out).toBe('released');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('failed');
  });

  test('an unknown build: not-found does not throw (the idempotent surface for a stale id from the chief)', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    expect(cancelBuild(machineDepsOf(s), 'build-nope')).toBe('not-found');
  });
});

describe('#1219 sweepZombieQueuedTodos repairs legacy zombies', () => {
  test('queued + the latest build without pending/claimed steps -> falls back and releases (with an active-step control group)', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const teamId = s.team.id;
    const base = Date.now();
    s.db.insert(projectTable).values({ id: 'proj-z', name: 'zombie', teamId }).run();
    const mk = (suffix: string, opts: { stepStatus: 'failed' | 'stopped' | 'pending' | null }) => {
      const todoId = `todo-z-${suffix}`;
      const buildId = `build-z-${suffix}`;
      s.db
        .insert(todoTable)
        .values({
          id: todoId,
          teamId,
          projectId: 'proj-z',
          title: `zombie ${suffix}`,
          phase: 'queued',
          phaseAt: base,
          seqNum: 1,
          assignment: { plan: { agentId: 'agent-z' }, build: { agentId: 'agent-z' } },
          latestBuildId: buildId,
        })
        .run();
      s.db
        .insert(buildTable)
        .values({
          id: buildId,
          todoId,
          withPlan: true,
          prevPhase: 'todo',
          triggerSource: 'chief',
          createdAt: base,
        })
        .run();
      if (opts.stepStatus !== null) {
        s.db
          .insert(stepTable)
          .values({
            id: `step-z-${suffix}`,
            buildId,
            kind: 'plan',
            status: opts.stepStatus,
            createdAt: base,
          })
          .run();
      }
      return { todoId, buildId };
    };
    const zombieFailed = mk('failed', { stepStatus: 'failed' });
    const zombieStopped = mk('stopped', { stepStatus: 'stopped' });
    const zombieNoStep = mk('nostep', { stepStatus: null });
    const liveQueued = mk('live', { stepStatus: 'pending' });

    sweepZombieQueuedTodos(s.svc, base);

    for (const z of [zombieFailed, zombieStopped, zombieNoStep]) {
      const row = s.db.select().from(todoTable).where(eq(todoTable.id, z.todoId)).get()!;
      expect(row.phase).toBe('todo');
      const buildRow = s.db.select().from(buildTable).where(eq(buildTable.id, z.buildId)).get()!;
      expect(buildRow.errorMessage).toBe(STOP_MESSAGE);
    }
    const live = s.db.select().from(todoTable).where(eq(todoTable.id, liveQueued.todoId)).get()!;
    expect(live.phase).toBe('queued');
  });
});

describe('#1219 the grace period for a pinned online machine not claiming', () => {
  interface WedgeWorld {
    s: TestServer;
    teamId: string;
    todoId: string;
    buildId: string;
    stepId: string;
    machineId: string;
    base: number;
  }
  function makeWedgeWorld(opts: {
    ago: number;
    machineCap: number;
    machineLoad: number;
  }): WedgeWorld {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const base = Date.now();
    const teamId = s.team.id;
    const todoId = `todo-w-${Math.random().toString(36).slice(2)}`;
    const buildId = `build-w-${Math.random().toString(36).slice(2)}`;
    const stepId = `step-w-${Math.random().toString(36).slice(2)}`;
    const machineId = `machine-w-${Math.random().toString(36).slice(2)}`;
    s.db.insert(projectTable).values({ id: 'proj-w', name: 'wedge', teamId }).run();
    insertMachine(s, machineId, { cap: opts.machineCap });
    s.db
      .insert(agentTable)
      .values({
        id: 'agent-w',
        teamId,
        displayName: 'wedge-agent',
        provider: 'stub-gw',
        modelId: 'stub-model',
        machineId,
      })
      .run();
    s.db
      .insert(todoTable)
      .values({
        id: todoId,
        teamId,
        projectId: 'proj-w',
        title: 'wedge target',
        phase: 'queued',
        phaseAt: base,
        seqNum: 1,
        assignment: { plan: { agentId: 'agent-w' }, build: { agentId: 'agent-w' } },
        latestBuildId: buildId,
      })
      .run();
    s.db
      .insert(buildTable)
      .values({
        id: buildId,
        todoId,
        withPlan: true,
        prevPhase: 'todo',
        triggerSource: 'chief',
        createdAt: base - opts.ago,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({ id: stepId, buildId, kind: 'plan', status: 'pending', createdAt: base - opts.ago })
      .run();
    const loadBuild = `build-load-${Math.random().toString(36).slice(2)}`;
    const loadTodo = `todo-load-${Math.random().toString(36).slice(2)}`;
    s.db
      .insert(todoTable)
      .values({
        id: loadTodo,
        teamId,
        projectId: 'proj-w',
        title: 'load',
        phase: 'building',
        phaseAt: base,
        seqNum: 2,
        assignment: { plan: { agentId: 'agent-w' }, build: { agentId: 'agent-w' } },
        latestBuildId: loadBuild,
      })
      .run();
    s.db
      .insert(buildTable)
      .values({
        id: loadBuild,
        todoId: loadTodo,
        withPlan: false,
        prevPhase: 'todo',
        triggerSource: 'user',
        createdAt: base,
      })
      .run();
    for (let i = 0; i < opts.machineLoad; i++) {
      s.db
        .insert(stepTable)
        .values({
          id: `step-load-${i}-${Math.random().toString(36).slice(2)}`,
          buildId: loadBuild,
          kind: 'build',
          status: 'claimed',
          machineId,
          claimedAt: base - 60_000,
          lastHeartbeatAt: base,
          createdAt: base,
        })
        .run();
    }
    return { s, teamId, todoId, buildId, stepId, machineId, base };
  }

  test('online + gate open + a free concurrency slot + past the grace: held waiting for the machine (#1257: not failed, resumes once the daemon claims again)', () => {
    const w = makeWedgeWorld({
      ago: 660_000,
      machineCap: 8,
      machineLoad: 0,
    });
    sweepAbandonedBuildSteps(w.s.svc, w.base);
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    expect(stepRow.status).toBe('pending');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('queued');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()!;
    expect(buildRow.errorMessage).toBeNull();
  });

  test('control group: the pinned machine at capacity (claimed at cap) -> legitimately queued, not failed', () => {
    const w = makeWedgeWorld({
      ago: 660_000,
      machineCap: 1,
      machineLoad: 1,
    });
    sweepAbandonedBuildSteps(w.s.svc, w.base);
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    expect(stepRow.status).toBe('pending');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('queued');
  });

  test('control group: within the grace (gate open, slot free, not timed out) -> untouched; the normal claim path unchanged', async () => {
    const w = makeWedgeWorld({ ago: 60_000, machineCap: 8, machineLoad: 0 });
    sweepAbandonedBuildSteps(w.s.svc, w.base);
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    expect(stepRow.status).toBe('pending');
    const claimed = await claimStep(
      machineDepsOf(w.s),
      w.machineId,
      w.teamId,
      10,
      'http://localhost',
    );
    expect(claimed).not.toBeNull();
    expect(claimed!.step.id).toBe(w.stepId);
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('planning');
  });
});
