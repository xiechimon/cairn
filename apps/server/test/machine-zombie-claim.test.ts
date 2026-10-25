import { machineClaimResponseSchema, machineEnrollResponseSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { claimStep } from '../src/services/machines.js';
import { bootServer, issueApiKey, postProject, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const HOLD_MS = 5_000;

async function settleSoon<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}（${ms}ms 内未返回）`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(timer);
  }
}

interface World {
  s: TestServer;
  teamId: string;
  buildId: string;
  machineAId: string;
  machineBId: string;
  enqueueStep(): string;
  insertStep(): string;
}

function makeWorld(): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const base = Date.now();
  const suffix = Math.random().toString(36).slice(2);
  const teamId = s.team.id;
  const buildId = `build-${suffix}`;
  const machineAId = `machine-a-${suffix}`;
  const machineBId = `machine-b-${suffix}`;
  for (const [id, name] of [
    [machineAId, 'dead-daemon'],
    [machineBId, 'live-daemon'],
  ] as const) {
    s.db
      .insert(machineTable)
      .values({ id, teamId, name, online: true, enabledRuntimes: ['pi'] })
      .run();
  }
  s.db
    .insert(agentTable)
    .values({
      id: `agent-${suffix}`,
      teamId,
      displayName: 'zombie-agent',
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: machineBId,
    })
    .run();
  s.db
    .insert(projectTable)
    .values({ id: `proj-${suffix}`, name: 'zombie', teamId })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: `todo-${suffix}`,
      teamId,
      projectId: `proj-${suffix}`,
      title: 'zombie target',
      phase: 'building',
      phaseAt: base,
      seqNum: 1,
      assignment: { plan: null, build: { agentId: `agent-${suffix}` } },
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId: `todo-${suffix}`,
      withPlan: false,
      triggerSource: 'user',
      createdAt: base - 600_000,
    })
    .run();
  let seq = 0;
  const insert = () => {
    const id = `step-${suffix}-${seq}`;
    seq += 1;
    s.db
      .insert(stepTable)
      .values({
        id,
        buildId,
        kind: 'build',
        status: 'pending',
        machineId: null,
        createdAt: base + seq,
      })
      .run();
    return id;
  };
  return {
    s,
    teamId,
    buildId,
    machineAId,
    machineBId,
    enqueueStep: () => {
      const id = insert();
      s.machineHub.wake(teamId);
      return id;
    },
    insertStep: insert,
  };
}

function machineDepsOf(w: World) {
  return {
    ...w.s.svc,
    box: w.s.secretBox,
    reposDir: w.s.reposDir,
    attachmentsDir: w.s.attachmentsDir,
  };
}

function stepRow(w: World, id: string) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, id)).get()!;
}

describe('#1065 zombie claim (service surface: claimStep binds the request liveness)', () => {
  test('abort during hold -> new step enqueued wake: dead request does not claim, step stays pending, home-machine new request still claims', async () => {
    const w = makeWorld();
    const ctrl = new AbortController();
    const claim = claimStep(
      machineDepsOf(w),
      w.machineBId,
      w.teamId,
      HOLD_MS,
      'http://localhost',
      ctrl.signal,
    );
    await Promise.resolve();
    ctrl.abort();
    const stepId = w.enqueueStep();
    const out = await settleSoon(
      claim,
      300,
      'claim 未随 abort 即时返回（waiter 残留到 hold 到期）',
    );
    expect(out).toBeNull();
    const row = stepRow(w, stepId);
    expect(row.machineId).toBeNull();
    expect(row.status).toBe('pending');
    const foreign = await settleSoon(
      claimStep(machineDepsOf(w), w.machineAId, w.teamId, 10, 'http://localhost'),
      1_000,
      '别机 claim 未返回',
    );
    expect(foreign).toBeNull();
    const live = await settleSoon(
      claimStep(machineDepsOf(w), w.machineBId, w.teamId, 10, 'http://localhost'),
      1_000,
      '活机 claim 未返回',
    );
    expect(live?.step.machineId).toBe(w.machineBId);
  });

  test('wake wakes first, abort arrives later: claimStep exit re-check intercepts, dead machine does not claim', async () => {
    const w = makeWorld();
    const ctrl = new AbortController();
    const claim = claimStep(
      machineDepsOf(w),
      w.machineBId,
      w.teamId,
      HOLD_MS,
      'http://localhost',
      ctrl.signal,
    );
    await Promise.resolve();
    const stepId = w.enqueueStep();
    ctrl.abort();
    const out = await settleSoon(claim, 300, 'claim 未在 wake+abort 后返回');
    expect(out).toBeNull();
    expect(stepRow(w, stepId).machineId).toBeNull();
  });

  test('request already dead on arrival (leader window): no tryClaim, directly empty', async () => {
    const w = makeWorld();
    const ctrl = new AbortController();
    ctrl.abort();
    const stepId = w.enqueueStep();
    const out = await claimStep(
      machineDepsOf(w),
      w.machineBId,
      w.teamId,
      10,
      'http://localhost',
      ctrl.signal,
    );
    expect(out).toBeNull();
    expect(stepRow(w, stepId).machineId).toBeNull();
  });

  test('live machine with a non-aborted signal: wake claims (rejection side does not hurt the claim side)', async () => {
    const w = makeWorld();
    const ctrl = new AbortController();
    const claim = claimStep(
      machineDepsOf(w),
      w.machineBId,
      w.teamId,
      HOLD_MS,
      'http://localhost',
      ctrl.signal,
    );
    await Promise.resolve();
    w.enqueueStep();
    const out = await settleSoon(claim, 300, '活机 claim 未随 wake 返回');
    expect(out?.step.machineId).toBe(w.machineBId);
  });

  test('no signal / hold elapsed: second tryClaim still runs (r3 section 1.5 old semantics unchanged)', async () => {
    const w = makeWorld();
    const claim = claimStep(machineDepsOf(w), w.machineBId, w.teamId, 20, 'http://localhost');
    await Promise.resolve();
    const stepId = w.insertStep();
    const out = await settleSoon(claim, 1_000, 'timeout 路径未返回');
    expect(out?.step.machineId).toBe(w.machineBId);
    expect(stepRow(w, stepId).status).toBe('claimed');
  });
});

describe('#1065 route wiring (claim route passes the request signal through)', () => {
  test('connection dropped during hold -> new step enqueued: dead-machine route does not claim, live-machine route still claims', async () => {
    const s = bootServer({ claimHoldMs: HOLD_MS });
    disposables.push(() => s.dispose());
    s.db
      .insert(agentTable)
      .values({
        id: 'agent-route',
        teamId: s.team.id,
        displayName: 'route-agent',
        provider: 'stub-gw',
        modelId: 'stub-model',
      })
      .run();
    const enroll = async (name: string) => {
      const key = await issueApiKey(s);
      const res = await s.app.request('/api/machine/enroll', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ teamId: s.team.id, name, cliVersion: '0.1.0' }),
      });
      expect(res.status).toBe(200);
      return machineEnrollResponseSchema.parse(await res.json());
    };
    const _machineA = await enroll('dead-daemon');
    const machineB = await enroll('live-daemon');
    const projectId = await postProject(s.app);
    const todoRes = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: '路由接线目标',
      spec: '写一行探针到 README.md',
    });
    const todoId = ((await todoRes.json()) as { id: string }).id;

    s.db
      .update(agentTable)
      .set({ machineId: machineB.machineId })
      .where(eq(agentTable.id, 'agent-route'))
      .run();
    const ctrl = new AbortController();
    const claimReq = new Request('http://localhost/api/machine/tasks/claim', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineB.token}`, 'content-type': 'application/json' },
      body: '{}',
      signal: ctrl.signal,
    });
    const resPromise = Promise.resolve(s.app.request(claimReq));
    await Promise.resolve();
    ctrl.abort();
    const buildRes = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: { agentId: 'agent-route' }, build: { agentId: 'agent-route' } },
      withPlan: true,
    });
    expect(buildRes.status).toBe(201);
    const res = await settleSoon(resPromise, 300, '路由 claim 未随 abort 即时返回');
    expect(res.status).toBe(200);
    const body = machineClaimResponseSchema.parse(await res.json());
    expect(body.step).toBeNull();

    const claimB = await settleSoon(
      Promise.resolve(
        s.app.request('/api/machine/tasks/claim', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${machineB.token}`,
            'content-type': 'application/json',
          },
          body: '{}',
        }),
      ),
      1_000,
      '活机路由 claim 未返回',
    );
    expect(claimB.status).toBe(200);
    const bodyB = machineClaimResponseSchema.parse(await claimB.json());
    expect(bodyB.step?.step.machineId).toBe(machineB.machineId);
  });
});
