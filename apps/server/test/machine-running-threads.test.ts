import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { claimStep } from '../src/services/machines.js';
import {
  bootServer,
  issueApiKey,
  postProject,
  req,
  seedRoute,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const MACHINE_NAME = 'running-mbp';

interface MachineListRow {
  id: string;
  runningSteps?: number;
  running?: { threadId: string; title: string; projectId: string; startedAt: number }[];
}

interface World {
  s: TestServer;
  machineId: string;
  projectId: string;
}

let seq = 0;
let clock = 1_000_000;

function nextIds(): { suffix: string; now: number } {
  seq += 1;
  clock += 1_000;
  return { suffix: `run-${seq}`, now: clock };
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 100 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enrolled = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(
      readyMachine({ teamId: s.team.id, name: MACHINE_NAME, cliVersion: '0.1.0' }),
    ),
  });
  expect(enrolled.status).toBe(200);
  const machineId = s.db
    .select()
    .from(machineTable)
    .where(eq(machineTable.name, MACHINE_NAME))
    .get()!.id;
  s.db.update(machineTable).set({ online: true }).where(eq(machineTable.id, machineId)).run();
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model', machineId });
  seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'stub-model', machineId });
  const projectId = await postProject(s.app, 'running-proj');
  return { s, machineId, projectId };
}

function insertThread(
  s: TestServer,
  opts: { teamId: string; projectId: string; title: string },
): { todoId: string; buildId: string } {
  const { suffix, now } = nextIds();
  const todoId = `todo-${suffix}`;
  const buildId = `build-${suffix}`;
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: opts.teamId,
      projectId: opts.projectId,
      seqNum: seq,
      title: opts.title,
      phaseAt: now,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: now,
    })
    .run();
  return { todoId, buildId };
}

function ownThread(w: World, title: string): { todoId: string; buildId: string } {
  return insertThread(w.s, { teamId: w.s.team.id, projectId: w.projectId, title });
}

function insertStep(
  s: TestServer,
  opts: {
    buildId: string;
    machineId?: string | null;
    status?: 'pending' | 'claimed';
    kind?: 'build' | 'chief';
    claimedAt?: number | null;
  },
): string {
  const { suffix, now } = nextIds();
  const stepId = `step-${suffix}`;
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: opts.buildId,
      kind: opts.kind ?? 'build',
      machineId: opts.machineId ?? null,
      status: opts.status ?? 'pending',
      createdAt: now,
      claimedAt: opts.status === 'claimed' ? (opts.claimedAt ?? now) : null,
    })
    .run();
  return stepId;
}

function claimAs(w: World) {
  return claimStep(
    {
      ...w.s.svc,
      box: w.s.secretBox,
      reposDir: w.s.reposDir,
      attachmentsDir: w.s.attachmentsDir,
      skillsDir: w.s.skillsDir,
    },
    w.machineId,
    w.s.team.id,
    10,
    'http://localhost',
  );
}

async function rowFor(s: TestServer, machineId: string): Promise<MachineListRow> {
  const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`);
  expect(res.status).toBe(200);
  const rows = (await res.json()) as MachineListRow[];
  const row = rows.find((r) => r.id === machineId);
  expect(row).toBeDefined();
  return row!;
}

describe('G3 running threads on a machine', () => {
  test('failure mode 1: no claimed work lists nothing; claimStep adds the thread', async () => {
    const w = await setupWorld();
    expect((await rowFor(w.s, w.machineId)).running).toEqual([]);
    expect((await rowFor(w.s, w.machineId)).runningSteps).toBe(0);
    const { todoId, buildId } = ownThread(w, 'Running thread');
    const stepId = insertStep(w.s, { buildId });
    expect(await claimAs(w)).not.toBeNull();
    const claimedAt = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, stepId))
      .get()!.claimedAt;
    const row = await rowFor(w.s, w.machineId);
    expect(row.running).toEqual([
      { threadId: todoId, title: 'Running thread', projectId: w.projectId, startedAt: claimedAt },
    ]);
    expect(row.runningSteps).toBe(1);
  });

  test('failure mode 2: a step that is not claimed, or whose build is gone, leaves the list', async () => {
    const w = await setupWorld();
    const { buildId } = ownThread(w, 'Ending thread');
    const stepId = insertStep(w.s, { buildId, machineId: w.machineId, status: 'claimed' });
    insertStep(w.s, { buildId: 'build-deleted', machineId: w.machineId, status: 'claimed' });
    const row = await rowFor(w.s, w.machineId);
    expect(row.running).toHaveLength(1);
    for (const status of ['done', 'pending', 'waiting_quota'] as const) {
      w.s.db.update(stepTable).set({ status }).where(eq(stepTable.id, stepId)).run();
      expect((await rowFor(w.s, w.machineId)).running).toEqual([]);
    }
  });

  test('failure mode 3: two claimed steps of one thread give one row with the earliest start', async () => {
    const w = await setupWorld();
    const long = ownThread(w, 'Long thread');
    const short = ownThread(w, 'Short thread');
    insertStep(w.s, {
      buildId: long.buildId,
      machineId: w.machineId,
      status: 'claimed',
      claimedAt: 5_000,
    });
    insertStep(w.s, {
      buildId: long.buildId,
      machineId: w.machineId,
      status: 'claimed',
      claimedAt: 3_000,
    });
    insertStep(w.s, {
      buildId: short.buildId,
      machineId: w.machineId,
      status: 'claimed',
      claimedAt: 4_000,
    });
    const row = await rowFor(w.s, w.machineId);
    expect(row.running?.map((t) => [t.threadId, t.startedAt])).toEqual([
      [long.todoId, 3_000],
      [short.todoId, 4_000],
    ]);
    expect(row.runningSteps).toBe(3);
  });

  test('failure mode 4: a claimed row without claimedAt reports its creation time', async () => {
    const w = await setupWorld();
    const { todoId, buildId } = ownThread(w, 'Legacy thread');
    const stepId = insertStep(w.s, {
      buildId,
      machineId: w.machineId,
      status: 'claimed',
      claimedAt: null,
    });
    const createdAt = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, stepId))
      .get()!.createdAt;
    expect((await rowFor(w.s, w.machineId)).running).toEqual([
      { threadId: todoId, title: 'Legacy thread', projectId: w.projectId, startedAt: createdAt },
    ]);
  });

  test('failure mode 5: a chief turn stays out of the list while runningSteps counts it', async () => {
    const w = await setupWorld();
    const now = Date.now();
    const chiefId = `chief-${w.s.user.id}-${w.s.team.id}`;
    w.s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        charter: '',
        createdAt: now,
      })
      .run();
    w.s.db
      .insert(chiefThreadTable)
      .values({
        id: 'chief-running-thread',
        chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        title: 'Chief turn',
        createdAt: now,
        updatedAt: now,
        sessionId: '',
        sessionOpenedAt: now,
        toolDefHashes: {},
        toolResultHashes: {},
        activeRun: { phase: 'chief' },
      })
      .run();
    insertStep(w.s, {
      buildId: 'chief-running-thread',
      machineId: w.machineId,
      status: 'claimed',
      kind: 'chief',
    });
    const row = await rowFor(w.s, w.machineId);
    expect(row.running).toEqual([]);
    expect(row.runningSteps).toBe(1);
  });

  test('failure mode 6: another team machine and another team thread stay out', async () => {
    const w = await setupWorld();
    const otherTeam = 'team-running-other';
    w.s.db.insert(teamTable).values({ id: otherTeam, name: 'other', createdAt: 1 }).run();
    w.s.db
      .insert(machineTable)
      .values({
        id: 'machine-running-other',
        teamId: otherTeam,
        name: 'other-mbp',
        online: true,
        enabledRuntimes: ['pi'],
      })
      .run();
    const foreign = insertThread(w.s, {
      teamId: otherTeam,
      projectId: w.projectId,
      title: 'Foreign thread',
    });
    insertStep(w.s, {
      buildId: foreign.buildId,
      machineId: 'machine-running-other',
      status: 'claimed',
    });
    insertStep(w.s, { buildId: foreign.buildId, machineId: w.machineId, status: 'claimed' });
    const res = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/machines`);
    const rows = (await res.json()) as MachineListRow[];
    expect(rows.some((r) => r.id === 'machine-running-other')).toBe(false);
    expect(rows.flatMap((r) => r.running ?? [])).toEqual([]);
    expect((await rowFor(w.s, w.machineId)).runningSteps).toBe(1);
  });
});
