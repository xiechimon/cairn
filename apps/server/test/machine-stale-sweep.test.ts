import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  MACHINE_STALE_OFFLINE_MS,
  type MachineDeps,
  markPresence,
  sweepStaleMachines,
} from '../src/services/machines.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface StaleWorld {
  s: TestServer;
  teamId: string;
  machineId: string;
  todoId: string;
  buildId: string;
  stepId: string;
  base: number;
}

function makeWorld(opts: {
  machineOnline: boolean;
  lastSeenAtAgo: number | null;
  withClaimedStep?: boolean;
  stepAgeMs?: number;
  heartbeatAgoMs?: number;
}): StaleWorld {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const base = Date.now();
  const teamId = s.team.id;
  const machineId = `machine-${Math.random().toString(36).slice(2)}`;
  const todoId = `todo-${Math.random().toString(36).slice(2)}`;
  const buildId = `build-${Math.random().toString(36).slice(2)}`;
  const stepId = `step-${Math.random().toString(36).slice(2)}`;
  s.db
    .insert(machineTable)
    .values({
      id: machineId,
      teamId,
      name: 'stale-box',
      online: opts.machineOnline,
      ...(opts.lastSeenAtAgo === null ? {} : { lastSeenAt: base - opts.lastSeenAtAgo }),
    })
    .run();
  if (opts.withClaimedStep === true) {
    const age = opts.stepAgeMs ?? 300_000;
    const beatAgo = opts.heartbeatAgoMs ?? age - 150_000;
    s.db.insert(projectTable).values({ id: 'proj-stale', name: 'stale', teamId }).run();
    s.db
      .insert(todoTable)
      .values({
        id: todoId,
        teamId,
        projectId: 'proj-stale',
        title: 'stale target',
        phase: 'building',
        phaseAt: base - age,
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
        createdAt: base - age,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: stepId,
        buildId,
        kind: 'build',
        status: 'claimed',
        machineId,
        createdAt: base - age,
        claimedAt: base - age,
        lastHeartbeatAt: base - beatAgo,
      })
      .run();
  }
  return { s, teamId, machineId, todoId, buildId, stepId, base };
}

function machineRowOf(w: StaleWorld) {
  return w.s.db.select().from(machineTable).where(eq(machineTable.id, w.machineId)).get()!;
}

function stepRowOf(w: StaleWorld) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
}

function tapTeamStream(s: TestServer, teamId: string): { events: object[] } {
  const events: object[] = [];
  s.hub.subscribe(teamId, {
    nextSeq: () => 1,
    send: (payload: object) => {
      events.push(payload);
      return Promise.resolve();
    },
  });
  return { events };
}

function machineDepsOf(w: StaleWorld): MachineDeps {
  return {
    ...w.s.svc,
    box: w.s.secretBox,
    reposDir: w.s.reposDir,
    attachmentsDir: w.s.attachmentsDir,
  };
}

describe('sweepStaleMachines (#1136 machine row staleness judgment)', () => {
  test('threshold pinned at 150s: covers 30s presence + 15s tick + jitter (false kill costs more than missing kill, same derivation as Multica 150s)', () => {
    expect(MACHINE_STALE_OFFLINE_MS).toBe(150_000);
  });

  test('healthy machine (lastSeenAt within the beat) not flipped -- false kill would allow affinity reassignment and lose sessions', () => {
    const w = makeWorld({ machineOnline: true, lastSeenAtAgo: 35_000 });
    const { events } = tapTeamStream(w.s, w.teamId);

    sweepStaleMachines(w.s.svc, w.base);

    expect(machineRowOf(w).online).toBe(true);
    expect(events).toHaveLength(0);
  });

  test('over-threshold online machine flips offline + team stream machine_presence event (same funnel as SSE abort)', () => {
    const w = makeWorld({ machineOnline: true, lastSeenAtAgo: MACHINE_STALE_OFFLINE_MS + 1_000 });
    const { events } = tapTeamStream(w.s, w.teamId);

    sweepStaleMachines(w.s.svc, w.base);

    expect(machineRowOf(w).online).toBe(false);
    expect(events).toEqual([{ type: 'machine_presence', machineId: w.machineId, online: false }]);
  });

  test('exactly at the threshold not flipped (strictly greater, beat-edge machines not cut)', () => {
    const w = makeWorld({ machineOnline: true, lastSeenAtAgo: MACHINE_STALE_OFFLINE_MS });

    sweepStaleMachines(w.s.svc, w.base);

    expect(machineRowOf(w).online).toBe(true);
  });

  test('offline machine untouched (only online->offline one-way; idempotent = second round no duplicate event)', () => {
    const w = makeWorld({ machineOnline: false, lastSeenAtAgo: MACHINE_STALE_OFFLINE_MS + 1_000 });
    const { events } = tapTeamStream(w.s, w.teamId);

    sweepStaleMachines(w.s.svc, w.base);
    sweepStaleMachines(w.s.svc, w.base + 60_000);

    expect(machineRowOf(w).online).toBe(false);
    expect(events).toHaveLength(0);
  });

  test('upgrade path: online=true and lastSeenAt=NULL (legacy rows) not flipped -- no data no judgment, next presence tick fills it', () => {
    const w = makeWorld({ machineOnline: true, lastSeenAtAgo: null });

    sweepStaleMachines(w.s.svc, w.base + 3600_000);

    expect(machineRowOf(w).online).toBe(true);
  });

  test('only flips online and does not touch steps: machine scan runs alone, claimed step rows as-is (step release belongs to sweepAbandonedBuildSteps own criteria)', () => {
    const w = makeWorld({
      machineOnline: true,
      lastSeenAtAgo: MACHINE_STALE_OFFLINE_MS + 1_000,
      withClaimedStep: true,
      stepAgeMs: 300_000,
    });

    sweepStaleMachines(w.s.svc, w.base);

    expect(machineRowOf(w).online).toBe(false);
    const stepRow = stepRowOf(w);
    expect(stepRow.status).toBe('claimed');
    expect(stepRow.machineId).toBe(w.machineId);
  });

  test('presence write-back: markPresence lands lastSeenAt + offline machine flips back online + event (brief-drop recovery takes the existing becameOnline path)', () => {
    const w = makeWorld({ machineOnline: false, lastSeenAtAgo: 600_000 });
    const { events } = tapTeamStream(w.s, w.teamId);

    markPresence(machineDepsOf(w), w.machineId, {});
    expect(machineRowOf(w).online).toBe(true);
    expect(machineRowOf(w).lastSeenAt).toBeGreaterThanOrEqual(w.base);

    sweepStaleMachines(w.s.svc, Date.now());
    expect(machineRowOf(w).online).toBe(true);
    expect(events).toEqual([{ type: 'machine_presence', machineId: w.machineId, online: true }]);
  });
});

describe('scheduler tick wiring (#861 last residual entry for permanently-claimed steps is closed)', () => {
  test('one tick: zombie machine (online + lastSeenAt past threshold + heartbeat had advanced) flips offline, same tick lost-contact claimed step released back to pending', () => {
    const w = makeWorld({
      machineOnline: true,
      lastSeenAtAgo: MACHINE_STALE_OFFLINE_MS + 1_000,
      withClaimedStep: true,
      stepAgeMs: 300_000,
    });
    const scheduler = createScheduler(w.s.svc, { tickMs: 60_000 });

    scheduler.tick(w.base);

    expect(machineRowOf(w).online).toBe(false);
    expect(stepRowOf(w).status).toBe('pending');
    expect(stepRowOf(w).machineId).toBeNull();
    scheduler.stop();
  });

  test('machine online + heartbeat had advanced (pre-change permanently-claimed shape): step not released -- machine scan does not wrongly flip online machines', () => {
    const w = makeWorld({
      machineOnline: true,
      lastSeenAtAgo: 30_000,
      withClaimedStep: true,
      stepAgeMs: 300_000,
    });
    const scheduler = createScheduler(w.s.svc, { tickMs: 60_000 });

    scheduler.tick(w.base);

    expect(machineRowOf(w).online).toBe(true);
    expect(stepRowOf(w).status).toBe('claimed');
    scheduler.stop();
  });

  test('a synthetic future time from manual tick does not flip healthy machines (m5 timer-loop drive convention): machine scan anchors the real clock', () => {
    const w = makeWorld({ machineOnline: true, lastSeenAtAgo: 30_000 });
    const scheduler = createScheduler(w.s.svc, { tickMs: 60_000 });

    scheduler.tick(w.base + 300_000);

    expect(machineRowOf(w).online).toBe(true);
    scheduler.stop();
  });
});
