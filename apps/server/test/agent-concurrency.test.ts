import { agentRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { claimStep } from '../src/services/machines.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const AGENT_A = 'agent-agcap-a';
const AGENT_B = 'agent-agcap-b';

interface World {
  s: TestServer;
  tokenA: string;
  machineAId: string;
  projectId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 100 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const res = await fetchEnroll(s, key);
  const tokenA = res.token;
  const machineAId = s.db
    .select()
    .from(machineTable)
    .where(eq(machineTable.name, 'agcap-mbp'))
    .get()!.id;
  for (const [id, name] of [
    [AGENT_A, 'agcap-agent-a'],
    [AGENT_B, 'agcap-agent-b'],
  ] as const) {
    s.db
      .insert(agentTable)
      .values({
        id,
        teamId: s.team.id,
        displayName: name,
        status: 'active',
        avatarUrl: null,
        provider: 'stub-gw',
        modelId: 'stub-model',
        thinkingLevel: null,
        tools: [],
        secrets: [],
        defaultSkill: null,
        skillsAllowlist: null,
        mcpServers: [],
        maxConcurrentTasks: null,
      })
      .run();
  }
  bindAllAgents(s);
  const projectId = await postProject(s.app, 'agcap-proj');
  return { s, tokenA, machineAId, projectId };
}

async function fetchEnroll(s: TestServer, key: string): Promise<{ token: string }> {
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'agcap-mbp', cliVersion: '0.1.0' }),
  });

  expect(res.status).toBe(200);
  return (await res.json()) as { token: string };
}

let seqCounter = 9_700;

function insertPendingBuildStep(
  s: TestServer,
  world: World,
  opts: { agentId: string },
): { todoId: string; buildId: string; stepId: string } {
  const suffix = Math.random().toString(36).slice(2, 8);
  seqCounter += 1;
  const now = seqCounter;
  s.db
    .insert(todoTable)
    .values({
      id: `todo-agcap-${suffix}`,
      teamId: s.team.id,
      projectId: world.projectId,
      seqNum: seqCounter,
      title: `agent 闸任务 ${suffix}`,
      spec: '探针',
      phase: 'queued',
      phaseAt: now,
      assignment: { plan: null, build: { agentId: opts.agentId } },
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: `build-agcap-${suffix}`,
      todoId: `todo-agcap-${suffix}`,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: now,
    })
    .run();
  const stepId = `step-agcap-${suffix}`;
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: `build-agcap-${suffix}`,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt: now + 1,
    })
    .run();
  return { todoId: `todo-agcap-${suffix}`, buildId: `build-agcap-${suffix}`, stepId };
}

function insertClaimedAgentStep(
  s: TestServer,
  world: World,
  opts: {
    agentId: string;
    machineId: string;
    kind?: 'build' | 'review';
    prompt?: string | null;
  },
): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  seqCounter += 1;
  const now = seqCounter;
  s.db
    .insert(todoTable)
    .values({
      id: `todo-agrun-${suffix}`,
      teamId: s.team.id,
      projectId: world.projectId,
      seqNum: seqCounter,
      title: `agent 闸在跑 ${suffix}`,
      spec: '探针',
      phase: 'building',
      phaseAt: now,
      assignment: { plan: null, build: { agentId: opts.agentId } },
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: `build-agrun-${suffix}`,
      todoId: `todo-agrun-${suffix}`,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: now,
    })
    .run();
  const stepId = `step-agrun-${suffix}`;
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: `build-agrun-${suffix}`,
      kind: opts.kind ?? 'build',
      machineId: opts.machineId,
      status: 'claimed',
      prompt: opts.prompt ?? null,
      freshSession: false,
      createdAt: now + 1,
      claimedAt: now + 1,
      lastHeartbeatAt: now + 1,
    })
    .run();
  return stepId;
}

function insertClaimedChiefStep(s: TestServer, world: World, agentId: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  const now = Date.now();
  const chiefId = `chief-${suffix}`;
  const threadId = `chief-thread-agcap-${suffix}`;
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: s.user.id,
      teamId: s.team.id,
      agentId,
      charter: '',
      createdAt: now,
    })
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: threadId,
      chiefId,
      userId: s.user.id,
      teamId: s.team.id,
      title: 'agcap chief 线程',
      createdAt: now,
      updatedAt: now,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: now,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: { phase: 'chief' },
    })
    .run();
  const stepId = `step-chief-agcap-${suffix}`;
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: threadId,
      kind: 'chief',
      machineId: world.machineAId,
      status: 'claimed',
      prompt: '帮我看看',
      createdAt: now + 1,
      claimedAt: now + 1,
      lastHeartbeatAt: now + 1,
    })
    .run();
  return stepId;
}

function machineDepsOf(w: World) {
  return {
    ...w.s.svc,
    box: w.s.secretBox,
    reposDir: w.s.reposDir,
    attachmentsDir: w.s.attachmentsDir,
    skillsDir: w.s.skillsDir,
  };
}

function claimAs(w: World, machineId = w.machineAId) {
  return claimStep(machineDepsOf(w), machineId, w.s.team.id, 10, 'http://localhost');
}

function setAgentCap(w: World, agentId: string, cap: number | null): void {
  w.s.db
    .update(agentTable)
    .set({ maxConcurrentTasks: cap })
    .where(eq(agentTable.id, agentId))
    .run();
}

describe('#1138 agent concurrency gate (cap as gate / per-pool / zero-value regression / free slot claims)', () => {
  test('failure mode 1: cap 1 -> the agent second step stays pending instead of claiming', async () => {
    const w = await setupWorld();
    setAgentCap(w, AGENT_A, 1);
    insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: w.machineAId });
    const { stepId } = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    const claimed = await claimAs(w);
    expect(claimed).toBeNull();
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status).toBe(
      'pending',
    );
  });

  test('failure mode 2: per-pool does not block the head -- when A is full, candidate B from the same batch still claims', async () => {
    const w = await setupWorld();
    setAgentCap(w, AGENT_A, 1);
    insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: w.machineAId });
    insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    const candB = insertPendingBuildStep(w.s, w, { agentId: AGENT_B });
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(candB.stepId);
  });

  test('failure mode 3: zero-value regression -- an agent with no cap claims a new step while several are running', async () => {
    const w = await setupWorld();
    insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: w.machineAId });
    insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: w.machineAId });
    const { stepId } = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(stepId);
  });

  test('failure mode 4: a free slot claims -- the agent gate opens after a running step wraps up', async () => {
    const w = await setupWorld();
    setAgentCap(w, AGENT_A, 1);
    const running = insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: w.machineAId });
    const { stepId } = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    expect(await claimAs(w)).toBeNull();
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, running)).run();
    const claimed = await claimAs(w);
    expect(claimed?.step.id).toBe(stepId);
  });
});

describe('#1138 inter-gate interaction (cross-machine accounting / min synthesis / chief takes no slot / review accounting)', () => {
  test('failure mode 5: the machine has a free slot but the agent step on another machine is already counted -> still not claimed', async () => {
    const w = await setupWorld();
    setAgentCap(w, AGENT_A, 1);
    insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: 'machine-agcap-other' });
    const { stepId } = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    const claimed = await claimAs(w);
    expect(claimed).toBeNull();
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status).toBe(
      'pending',
    );
  });

  test('failure mode 6: chief steps take an agent slot (#1260 chief demotion) -- a running chief gates same-agent workers', async () => {
    const w = await setupWorld();
    setAgentCap(w, AGENT_A, 1);
    insertClaimedChiefStep(w.s, w, AGENT_A);
    const { stepId } = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    expect(await claimAs(w)).toBeNull();
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status).toBe(
      'pending',
    );
  });

  test('failure mode 7: review steps are accounted by prompt meta for that agent in-flight count', async () => {
    const w = await setupWorld();
    setAgentCap(w, AGENT_A, 1);
    insertClaimedAgentStep(w.s, w, {
      agentId: AGENT_B,
      machineId: 'machine-agcap-other',
      kind: 'review',
      prompt: `{"kind":"review","agentId":"${AGENT_A}"}\n审一下`,
    });
    const { stepId } = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    expect(await claimAs(w)).toBeNull();
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status).toBe(
      'pending',
    );
  });
});

describe('#1138 write surface and wire contract (PATCH validation / record projection)', () => {
  test('failure mode 8: PATCH persists immediately / null clears to unlimited / 0 and 51 -> 400 / old shape parses', async () => {
    const w = await setupWorld();
    for (const bad of [0, 51]) {
      const res = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${AGENT_A}`, {
        maxConcurrentTasks: bad,
      });
      expect(res.status).toBe(400);
    }
    const res = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${AGENT_A}`, {
      maxConcurrentTasks: 1,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { maxConcurrentTasks: number | null };
    expect(body.maxConcurrentTasks).toBe(1);
    expect(
      w.s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_A)).get()!.maxConcurrentTasks,
    ).toBe(1);
    insertClaimedAgentStep(w.s, w, { agentId: AGENT_A, machineId: w.machineAId });
    const gated = insertPendingBuildStep(w.s, w, { agentId: AGENT_A });
    expect(await claimAs(w)).toBeNull();
    const cleared = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${AGENT_A}`, {
      maxConcurrentTasks: null,
    });
    expect(cleared.status).toBe(200);
    const clearedBody = (await cleared.json()) as { maxConcurrentTasks: number | null };
    expect(clearedBody.maxConcurrentTasks).toBeNull();
    expect((await claimAs(w))?.step.id).toBe(gated.stepId);
    const parsed = agentRecordSchema.parse({
      id: 'a-old',
      displayName: 'old',
      description: null,
      status: 'active',
      avatarUrl: null,
      provider: null,
      modelId: null,
      thinkingLevel: null,
      tools: [],
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: [],
    });
    expect(parsed.maxConcurrentTasks).toBeUndefined();
  });
});
