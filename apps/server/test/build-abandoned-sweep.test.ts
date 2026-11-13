import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  machine as machineTable,
  project as projectTable,
  routingRule as routingRuleTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  ABANDONED_CLAIM_QUARANTINE_LIMIT,
  BUILD_ABANDONED_STEP_MS,
  sweepAbandonedBuildSteps,
} from '../src/services/build-abandoned-sweep.js';
import { claimStep } from '../src/services/machines.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer, seedRoute, seedSessionRoute, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface BuildWorld {
  s: TestServer;
  teamId: string;
  todoId: string;
  buildId: string;
  stepId: string;
  machineId: string;
  routeId: string | null;
  base: number;
}

function makeWorld(step: {
  status: 'pending' | 'claimed';
  kind?: 'plan' | 'build' | 'merge' | 'review' | 'chief' | 'verify';
  createdAgo: number;
  heartbeatAgo?: number | null;
  machineOnline?: boolean;
  withRoute?: boolean;
  routeProvider?: string;
  machineRuntimes?: string[];
  pin?: 'self' | 'ghost' | (string & {});
}): BuildWorld {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const base = Date.now();
  const teamId = s.team.id;
  const todoId = `todo-${Math.random().toString(36).slice(2)}`;
  const buildId = `build-${Math.random().toString(36).slice(2)}`;
  const stepId = `step-${Math.random().toString(36).slice(2)}`;
  const machineId = `machine-${Math.random().toString(36).slice(2)}`;
  const withRoute = step.withRoute === true || step.pin !== undefined;
  s.db.insert(projectTable).values({ id: 'proj-sweep', name: 'sweep', teamId }).run();
  s.db
    .insert(machineTable)
    .values(
      readyMachine({
        id: machineId,
        teamId,
        name: 'sweep-box',
        online: step.machineOnline ?? false,
        ...(step.machineRuntimes !== undefined
          ? { enabledRuntimes: step.machineRuntimes }
          : step.withRoute
            ? { enabledRuntimes: ['pi'] }
            : {}),
      }),
    )
    .run();
  const routeId = withRoute
    ? seedSessionRoute(s, {
        provider: step.routeProvider ?? 'pi',
        modelId: 'stub-model',
        machineId:
          step.pin === undefined || step.pin === 'self'
            ? machineId
            : step.pin === 'ghost'
              ? 'machine-gone'
              : step.pin,
      })
    : null;
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId,
      projectId: 'proj-sweep',
      title: 'sweep target',
      phase: 'building',
      phaseAt: base - step.createdAgo,
      seqNum: 1,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: base - step.createdAgo,
    })
    .run();
  const createdAt = base - step.createdAgo;
  const claimedAt = step.status === 'claimed' ? createdAt : null;
  const heartbeat =
    step.heartbeatAgo === undefined
      ? claimedAt
      : step.heartbeatAgo === null
        ? null
        : base - step.heartbeatAgo;
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: step.kind ?? 'build',
      status: step.status,
      machineId: step.status === 'claimed' ? machineId : null,
      createdAt,
      claimedAt,
      lastHeartbeatAt: step.status === 'claimed' ? heartbeat : null,
    })
    .run();
  return { s, teamId, todoId, buildId, stepId, machineId, routeId, base };
}

function stepRowOf(w: BuildWorld) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
}

function todoRowOf(w: BuildWorld) {
  return w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
}

function routeRowOf(w: BuildWorld) {
  if (w.routeId === null) throw new Error('world has no route');
  return w.s.db.select().from(routingRuleTable).where(eq(routingRuleTable.id, w.routeId)).get()!;
}
function buildRowOf(w: BuildWorld) {
  return w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()!;
}

function tapConvStream(s: TestServer, conversationId: string): { events: object[] } {
  const events: object[] = [];
  s.convHub.subscribe(conversationId, {
    nextSeq: () => 1,
    send: (payload: object) => {
      events.push(payload);
      return Promise.resolve();
    },
  });
  return { events };
}

function stepEventOf(events: object[], stepId: string): { status: string } {
  const ev = events.find(
    (e): e is { type: string; step: unknown } => (e as { type?: string }).type === 'step',
  );
  if (ev === undefined) throw new Error('no step event on the conversation stream');
  if ((ev.step as { id: string }).id !== stepId) throw new Error('step event for another step');
  return ev.step as { status: string };
}

function addOnlineMachine(w: BuildWorld, name = 'mea'): string {
  const id = `machine-${Math.random().toString(36).slice(2)}`;
  w.s.db
    .insert(machineTable)
    .values(readyMachine({ id, teamId: w.teamId, name, online: true }))
    .run();
  return id;
}

function machineDepsOf(w: BuildWorld) {
  return {
    ...w.s.svc,
    box: w.s.secretBox,
    reposDir: w.s.reposDir,
    attachmentsDir: w.s.attachmentsDir,
  };
}

describe('#862 T1 release of lost-contact claimed steps (sweepAbandonedBuildSteps)', () => {
  test('claimed heartbeat stale past threshold + machine offline: released back to pending (machine slot cleared, phase unchanged, no failure trace) + conversation-stream step event + wake rouses the claim loop', async () => {
    const w = makeWorld({ status: 'claimed', createdAgo: 300_000, heartbeatAgo: 300_000 });
    const { events } = tapConvStream(w.s, w.buildId);
    const woken = w.s.svc.machineHub.waitWake(w.teamId, 50);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    const row = stepRowOf(w);
    expect(row.status).toBe('pending');
    expect(row.machineId).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
    expect(buildRowOf(w).errorMessage).toBeNull();
    expect(stepEventOf(events, w.stepId).status).toBe('pending');
    await expect(woken).resolves.toBe(true);
  });

  test('B-C7: claimed with zero heartbeat progress past threshold + machine online: also released (server marked claimed but the machine executed nothing, step can be reclaimed by another machine or this machine)', () => {
    const w = makeWorld({
      status: 'claimed',
      createdAgo: 300_000,
      machineOnline: true,
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(stepRowOf(w).machineId).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('after release the preferred machine can reclaim: while it is online another machine comes up empty (#1259 overflow wait), the preferred machine claims the same step', async () => {
    const w = makeWorld({
      status: 'claimed',
      createdAgo: 300_000,
      heartbeatAgo: 300_000,
      withRoute: true,
    });
    const meaId = `machine-mea-${Math.random().toString(36).slice(2)}`;
    w.s.db
      .insert(machineTable)
      .values(
        readyMachine({
          id: meaId,
          teamId: w.teamId,
          name: 'mea',
          online: true,
          enabledRuntimes: ['pi'],
        }),
      )
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepRowOf(w).status).toBe('pending');

    w.s.db.update(machineTable).set({ online: true }).where(eq(machineTable.id, w.machineId)).run();
    const other = await claimStep(machineDepsOf(w), meaId, w.teamId, 10, 'http://localhost');
    expect(other).toBeNull();
    const claimed = await claimStep(
      machineDepsOf(w),
      w.machineId,
      w.teamId,
      10,
      'http://localhost',
    );
    if (claimed === null) throw new Error('released step was not reclaimable by home machine');
    expect(claimed.step.id).toBe(w.stepId);
    expect(claimed.step.machineId).toBe(w.machineId);
    expect(claimed.session.action).toBe('new');
  });

  test('reclaim after release carries the prior session: prior session present -> continue payload (#1259 home machine is always the same machine, session file always present -- fallback marked as history)', async () => {
    const w = makeWorld({
      status: 'claimed',
      createdAgo: 300_000,
      heartbeatAgo: 300_000,
      withRoute: true,
    });
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-prior-${Math.random().toString(36).slice(2)}`,
        buildId: w.buildId,
        kind: 'build',
        status: 'done',
        machineId: w.machineId,
        sessionId: 'sess-old',
        createdAt: w.base - 600_000,
      })
      .run();
    sweepAbandonedBuildSteps(w.s.svc, w.base);

    w.s.db.update(machineTable).set({ online: true }).where(eq(machineTable.id, w.machineId)).run();
    const claimed = await claimStep(
      machineDepsOf(w),
      w.machineId,
      w.teamId,
      10,
      'http://localhost',
    );
    if (claimed === null) throw new Error('released step was not reclaimable');
    expect(claimed.session).toEqual({ action: 'continue', sessionId: 'sess-old' });
  });

  test('pending past age + team has zero online machines: suspended waiting for a machine (#1257: nobody claiming is an infra event, not failed)', () => {
    const w = makeWorld({ status: 'pending', createdAgo: 300_000 });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
  });

  test('still no online machine after release -> suspended (#1257: release is not a failure wrap-up of endless waiting, a returning machine resumes it)', () => {
    const w = makeWorld({ status: 'claimed', createdAgo: 300_000, heartbeatAgo: 300_000 });

    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepRowOf(w).status).toBe('pending');

    sweepAbandonedBuildSteps(w.s.svc, w.base + 600_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('online machine present after release -> keeps queueing, not killed', () => {
    const w = makeWorld({ status: 'claimed', createdAgo: 300_000, heartbeatAgo: 300_000 });
    w.s.db
      .insert(machineTable)
      .values(
        readyMachine({
          id: `machine-mea-${Math.random().toString(36).slice(2)}`,
          teamId: w.teamId,
          name: 'mea',
          online: true,
        }),
      )
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepRowOf(w).status).toBe('pending');
    sweepAbandonedBuildSteps(w.s.svc, w.base + 600_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(todoRowOf(w).phase).toBe('building');
  });

  test('counterexample: fresh-heartbeat claimed step untouched (online or offline)', () => {
    const online = makeWorld({
      status: 'claimed',
      createdAgo: 300_000,
      heartbeatAgo: 10_000,
      machineOnline: true,
    });
    const offline = makeWorld({
      status: 'claimed',
      createdAgo: 300_000,
      heartbeatAgo: 10_000,
    });

    sweepAbandonedBuildSteps(online.s.svc, online.base);
    sweepAbandonedBuildSteps(offline.s.svc, offline.base);

    expect(stepRowOf(online).status).toBe('claimed');
    expect(stepRowOf(offline).status).toBe('claimed');
    expect(buildRowOf(online).errorMessage).toBeNull();
  });

  test('counterexample: pending with a team online machine = legal queueing, not touched', () => {
    const w = makeWorld({ status: 'pending', createdAgo: 300_000, machineOnline: true });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(todoRowOf(w).phase).toBe('building');
  });

  test('counterexample: pending not past age -> untouched', () => {
    const w = makeWorld({ status: 'pending', createdAgo: 10_000 });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
  });

  test('counterexample: claimed step on an online machine that had heartbeats then went stale = ambiguous state, untouched', () => {
    const w = makeWorld({
      status: 'claimed',
      createdAgo: 600_000,
      heartbeatAgo: 300_000,
      machineOnline: true,
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('claimed');
  });

  test('idempotent: terminal steps skipped; chief steps not in this surface', () => {
    const w = makeWorld({ status: 'claimed', createdAgo: 300_000, heartbeatAgo: 300_000 });
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-chief-other',
        buildId: 'chief-thread-1',
        kind: 'chief',
        status: 'claimed',
        machineId: w.machineId,
        createdAt: w.base - 300_000,
        claimedAt: w.base - 300_000,
        lastHeartbeatAt: w.base - 300_000,
      })
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepRowOf(w).status).toBe('pending');
    const chief = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, 'step-chief-other'))
      .get()!;
    expect(chief.status).toBe('claimed');
  });

  test('threshold at the same cadence as #684 (120 seconds, no new cadence invented)', () => {
    expect(BUILD_ABANDONED_STEP_MS).toBe(120_000);
  });

  test('scheduler tick wiring: tick(now) drives the sweep (real host path)', () => {
    const w = makeWorld({ status: 'claimed', createdAgo: 300_000, heartbeatAgo: 300_000 });
    const scheduler = createScheduler(w.s.svc, { tickMs: 60_000 });

    scheduler.tick(w.base);
    expect(stepRowOf(w).status).toBe('pending');
    scheduler.stop();
  });
});

describe('#1257 unclaimed suspension when the home machine is offline (home-machine form of sweepAbandonedBuildSteps)', () => {
  test('home machine offline + team has another online machine: untouched within the grace period (legal wait)', () => {
    const w = makeWorld({ status: 'pending', createdAgo: 90_000, pin: 'self' });
    addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(todoRowOf(w).phase).toBe('building');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('home machine offline + another machine online + past age: suspended waiting for a machine (#1257: no failure wrap-up, home machine returning auto-resumes -- board surfaces the "waiting for machine" chip)', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 600_000 + 1_000,
      pin: 'self',
    });
    const otherId = addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
    expect(routeRowOf(w).machineId).toBe(w.machineId);
    sweepAbandonedBuildSteps(w.s.svc, w.base + 60_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(otherId).not.toBe(w.machineId);
  });

  test('home machine offline + team has zero online machines: also suspended (visibility carried by the "waiting for machine" chip, not failed)', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 600_000 + 1_000,
      pin: 'self',
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('no home machine set: also suspended (setting one unlocks; board surfaces the "waiting for machine" chip, no indefinite silence)', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 600_000 + 1_000,
      withRoute: true,
      machineOnline: true,
    });
    w.s.db
      .update(routingRuleTable)
      .set({ machineId: null })
      .where(eq(routingRuleTable.id, w.routeId!))
      .run();
    addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
  });

  test('no home machine set: untouched (waiting for it to be set, stays pending)', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 90_000,
      withRoute: true,
      machineOnline: true,
    });
    w.s.db
      .update(routingRuleTable)
      .set({ machineId: null })
      .where(eq(routingRuleTable.id, w.routeId!))
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('home machine online: untouched (step waits for it to claim, legal queueing)', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 90_000,
      machineOnline: true,
      pin: 'self',
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(todoRowOf(w).phase).toBe('building');
  });

  test('home machine is another online machine: untouched (this machine cannot grab it -- the home-machine gate always refuses, step waits for its home)', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 1_800_000,
      withRoute: true,
      machineOnline: true,
    });
    const otherId = addOnlineMachine(w);
    w.s.db
      .update(routingRuleTable)
      .set({ machineId: otherId })
      .where(eq(routingRuleTable.id, w.routeId!))
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
  });

  test('re-wait after release: anchored on the step last activity (heartbeat), stays suspended after release (#1257: no death verdict, waits for the home machine to return)', () => {
    const w = makeWorld({
      status: 'claimed',
      createdAgo: 1_200_000,
      heartbeatAgo: 130_000,
      pin: 'self',
    });
    addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepRowOf(w).status).toBe('pending');

    sweepAbandonedBuildSteps(w.s.svc, w.base + 1_000);
    expect(stepRowOf(w).status).toBe('pending');

    sweepAbandonedBuildSteps(w.s.svc, w.base + 600_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('home machine offline but step heartbeat fresh (claimed running): untouched (claimed-surface criteria unchanged)', () => {
    const w = makeWorld({
      status: 'claimed',
      createdAgo: 1_200_000,
      heartbeatAgo: 10_000,
      pin: 'self',
    });
    addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('claimed');
  });
});

describe('#881 home machine online but blocked by the runtime gate (#1257 suspension semantics)', () => {
  test('home machine online + gate blocked (claude-code step x pi-only machine) + past age: suspended waiting for a machine (#1257: auto-resumes after runtime enabled, no failure wrap-up)', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 601_000,
      machineOnline: true,
      withRoute: true,
      routeProvider: 'claude-code',
      machineRuntimes: ['pi'],
      pin: 'self',
    });
    const otherId = addOnlineMachine(w);
    w.s.db
      .update(machineTable)
      .set({ enabledRuntimes: ['pi', 'claude-code'] })
      .where(eq(machineTable.id, otherId))
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
    expect(routeRowOf(w).machineId).toBe(w.machineId);
    sweepAbandonedBuildSteps(w.s.svc, w.base + 60_000);
    expect(stepRowOf(w).status).toBe('pending');
  });

  test('home machine online + gate blocked: untouched (runtime flag PATCH writes hot, enabling the gate auto-resumes claiming)', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 90_000,
      machineOnline: true,
      withRoute: true,
      routeProvider: 'claude-code',
      machineRuntimes: ['pi'],
      pin: 'self',
    });
    addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(todoRowOf(w).phase).toBe('building');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('home machine online + runtime on + at capacity: untouched (step queues in its queue, legal -- gate counterexample)', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 1_800_000,
      machineOnline: true,
      withRoute: true,
      routeProvider: 'claude-code',
      machineRuntimes: ['pi', 'claude-code'],
      pin: 'self',
    });
    for (let i = 0; i < 3; i++) {
      const loadStepId = `step-load-${i}-${Math.random().toString(36).slice(2)}`;
      w.s.db
        .insert(stepTable)
        .values({
          id: loadStepId,
          buildId: w.buildId,
          kind: 'build',
          status: 'claimed',
          machineId: w.machineId,
          claimedAt: w.base - 60_000,
          lastHeartbeatAt: w.base,
          createdAt: w.base,
        })
        .run();
    }

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('review step judged the same (provider read from the review routing rule): gate blocked also suspends', () => {
    const w = makeWorld({
      status: 'pending',
      kind: 'review',
      createdAgo: 601_000,
      machineOnline: true,
      withRoute: true,
      routeProvider: 'claude-code',
      machineRuntimes: ['pi'],
      pin: 'self',
    });
    seedRoute(w.s, 'review', { provider: 'claude-code', machineId: w.machineId });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('steps with no session route do not enter this check (unrouted = another seam family nobody can claim, not a gate block)', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 1_200_000,
      machineOnline: true,
      machineRuntimes: ['pi'],
    });
    addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
  });
});

describe('#1284 verify step sweep (sweepAbandonedBuildSteps adds the verify kind)', () => {
  test('claimed verify step heartbeat expired + machine offline: released back to pending (machine slot cleared, phase unchanged, no failure trace) + conversation-stream step event', async () => {
    const w = makeWorld({
      status: 'claimed',
      kind: 'verify',
      createdAgo: 300_000,
      heartbeatAgo: 300_000,
    });
    const { events } = tapConvStream(w.s, w.buildId);
    const woken = w.s.svc.machineHub.waitWake(w.teamId, 50);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    const row = stepRowOf(w);
    expect(row.status).toBe('pending');
    expect(row.machineId).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
    expect(buildRowOf(w).errorMessage).toBeNull();
    expect(stepEventOf(events, w.stepId).status).toBe('pending');
    await expect(woken).resolves.toBe(true);
  });

  test('B-C7 same shape: claimed verify step zero heartbeat progress past threshold + machine online: also released', () => {
    const w = makeWorld({
      status: 'claimed',
      kind: 'verify',
      createdAgo: 300_000,
      machineOnline: true,
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(stepRowOf(w).machineId).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('counterexample: fresh-heartbeat claimed verify step untouched', () => {
    const w = makeWorld({
      status: 'claimed',
      kind: 'verify',
      createdAgo: 300_000,
      heartbeatAgo: 10_000,
      machineOnline: true,
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('claimed');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('counterexample: done verify step untouched (terminal -- sweep only scans pending/claimed)', () => {
    const w = makeWorld({
      status: 'claimed',
      kind: 'verify',
      createdAgo: 300_000,
      heartbeatAgo: 300_000,
    });
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, w.stepId)).run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('done');
  });

  test('counterexample: failed verify step untouched (terminal -- sweep only scans pending/claimed)', () => {
    const w = makeWorld({
      status: 'claimed',
      kind: 'verify',
      createdAgo: 300_000,
      heartbeatAgo: 300_000,
    });
    w.s.db.update(stepTable).set({ status: 'failed' }).where(eq(stepTable.id, w.stepId)).run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('failed');
  });

  test('counterexample: pending verify step past age + team zero online: suspended waiting for a machine, untouched (#1257)', () => {
    const w = makeWorld({
      status: 'pending',
      kind: 'verify',
      createdAgo: 300_000,
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });
});

describe('#2582 crash-loop quarantine (releaseClaimedStep counts abandoned claims)', () => {
  test('one abandoned claim releases back to pending and counts it', () => {
    const w = makeWorld({ status: 'claimed', createdAgo: 300_000, heartbeatAgo: 300_000 });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(stepRowOf(w).claimCount).toBe(1);
    expect(buildRowOf(w).errorMessage).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
  });

  test('the Nth abandoned claim quarantines the step instead of releasing it', () => {
    const w = makeWorld({ status: 'claimed', createdAgo: 300_000, heartbeatAgo: 300_000 });
    w.s.db
      .update(stepTable)
      .set({ claimCount: ABANDONED_CLAIM_QUARANTINE_LIMIT - 1 })
      .where(eq(stepTable.id, w.stepId))
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('failed');
    expect(buildRowOf(w).errorMessage).toMatch(
      new RegExp(`crashed ${ABANDONED_CLAIM_QUARANTINE_LIMIT} times`),
    );
  });

  test('a claim that made progress before the machine went offline does not count toward quarantine', () => {
    const w = makeWorld({ status: 'claimed', createdAgo: 300_000, heartbeatAgo: 130_000 });
    w.s.db
      .update(stepTable)
      .set({ claimCount: ABANDONED_CLAIM_QUARANTINE_LIMIT - 1 })
      .where(eq(stepTable.id, w.stepId))
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(stepRowOf(w).claimCount).toBe(ABANDONED_CLAIM_QUARANTINE_LIMIT - 1);
  });

  test('quarantine limit is a small fixed number, not a sweeping timeout', () => {
    expect(ABANDONED_CLAIM_QUARANTINE_LIMIT).toBe(3);
  });
});
