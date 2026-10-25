import { chiefTurnErrorContentSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  chiefMessage,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { sweepAbandonedChiefSteps } from '../src/services/chief.js';
import { claimStep, type MachineDeps } from '../src/services/machines.js';
import { bootServer, insertMachine, postProject, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const AGENT_ID = 'agent-chief-demote';

interface World {
  s: TestServer;
  machineAId: string;
  machineBId: string;
  projectId: string;
  chiefId: string;
  threadId: string;
  stepId: string;
}

function machineDepsOf(s: TestServer): MachineDeps {
  return {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
}

async function setupWorld(
  opts: { agentMachineId?: string | null; bindAgent?: boolean; provider?: string } = {},
): Promise<World> {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const machineAId = insertMachine(s, { name: 'demote-a' });
  const machineBId = insertMachine(s, { name: 'demote-b' });
  const projectId = await postProject(s.app, 'demote-proj');
  const home = opts.agentMachineId === undefined ? machineAId : opts.agentMachineId;
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'demote-agent',
      provider: opts.provider ?? 'stub-gw',
      modelId: 'stub-model',
      thinkingLevel: 'high',
      machineId: home,
    })
    .run();
  const chiefId = `chief-${s.svc.user.id}-${s.team.id}`;
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      agentId: opts.bindAgent === false ? null : AGENT_ID,
      charter: '',
      createdAt: 1,
    })
    .run();
  const threadId = 'chief-demote-thread';
  s.db
    .insert(chiefThreadTable)
    .values({
      id: threadId,
      chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: '降级探针线程',
      createdAt: 2,
      updatedAt: 2,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: 2,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: { phase: 'chief' },
    })
    .run();
  const stepId = 'step-chief-demote-1';
  s.db
    .insert(stepTable)
    .values({ id: stepId, buildId: threadId, kind: 'chief', status: 'pending', createdAt: 3 })
    .run();
  return { s, machineAId, machineBId, projectId, chiefId, threadId, stepId };
}

function claimOn(w: World, machineId: string) {
  return claimStep(machineDepsOf(w.s), machineId, w.s.team.id, 10, 'http://localhost');
}

function stepRowOf(w: World, id = w.stepId) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, id)).get()!;
}

function turnErrorMessage(w: World): string | null {
  const row = w.s.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.id, `chief-err-${w.stepId}`))
    .get();
  if (!row) return null;
  const parsed = chiefTurnErrorContentSchema.safeParse(JSON.parse(row.content as string));
  return parsed.success ? parsed.data.message : null;
}

function insertClaimedOn(w: World, kind: 'build' | 'chief'): void {
  if (kind === 'chief') {
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-chief-occupied',
        buildId: w.threadId,
        kind: 'chief',
        machineId: w.machineAId,
        status: 'claimed',
        createdAt: 4,
        claimedAt: 4,
        lastHeartbeatAt: 4,
      })
      .run();
    return;
  }
  w.s.db
    .insert(todoTable)
    .values({
      id: 'todo-demote-1',
      teamId: w.s.team.id,
      projectId: w.projectId,
      seqNum: 991,
      title: '占槽任务',
      spec: '',
      phase: 'building',
      phaseAt: 4,
      assignment: { plan: null, build: { agentId: AGENT_ID } },
    })
    .run();
  w.s.db
    .insert(buildTable)
    .values({
      id: 'build-demote-1',
      todoId: 'todo-demote-1',
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: 4,
    })
    .run();
  w.s.db
    .insert(stepTable)
    .values({
      id: 'step-build-occupied',
      buildId: 'build-demote-1',
      kind: 'build',
      machineId: w.machineAId,
      status: 'claimed',
      createdAt: 5,
      claimedAt: 5,
      lastHeartbeatAt: 5,
    })
    .run();
}

function insertPendingWorkerStep(w: World): string {
  w.s.db
    .insert(todoTable)
    .values({
      id: 'todo-demote-2',
      teamId: w.s.team.id,
      projectId: w.projectId,
      seqNum: 992,
      title: '候选任务',
      spec: '',
      phase: 'queued',
      phaseAt: 6,
      assignment: { plan: null, build: { agentId: AGENT_ID } },
    })
    .run();
  w.s.db
    .insert(buildTable)
    .values({
      id: 'build-demote-2',
      todoId: 'todo-demote-2',
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: 6,
    })
    .run();
  w.s.db
    .insert(stepTable)
    .values({
      id: 'step-build-waiting',
      buildId: 'build-demote-2',
      kind: 'build',
      status: 'pending',
      createdAt: 7,
    })
    .run();
  return 'step-build-waiting';
}

describe('#1260 route re-source: chief step destination = the bound Agent home machine', () => {
  test('failure mode 1: another machine claims empty, step stays pending; the home machine claims it', async () => {
    const w = await setupWorld();
    expect(await claimOn(w, w.machineBId)).toBeNull();
    expect(stepRowOf(w).status).toBe('pending');
    const home = await claimOn(w, w.machineAId);
    expect(home?.step.id).toBe(w.stepId);
    expect(home?.step.machineId).toBe(w.machineAId);
  });

  test('failure mode 2: home machine runtime gate off -> home machine also comes up empty (same worker gate)', async () => {
    const w = await setupWorld({ provider: 'claude-code' });
    w.s.db
      .update(machineTable)
      .set({ enabledRuntimes: ['pi'] })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    expect(await claimOn(w, w.machineAId)).toBeNull();
    expect(stepRowOf(w).status).toBe('pending');
  });

  test('failure mode 5: payload model/thinking level = the bound Agent own config (no override slot)', async () => {
    const w = await setupWorld();
    const claimed = await claimOn(w, w.machineAId);
    expect(claimed?.agent?.provider).toBe('stub-gw');
    expect(claimed?.agent?.modelId).toBe('stub-model');
    expect(claimed?.agent?.thinkingLevel).toBe('high');
  });
});

describe('#1260 slot occupancy: chief steps are ordinary consumers of the machine and Agent slots', () => {
  test('failure mode 3a: worker at capacity (cap 1) -> chief step comes up empty, step stays pending', async () => {
    const w = await setupWorld();
    w.s.db
      .update(machineTable)
      .set({ maxConcurrent: 1 })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    insertClaimedOn(w, 'build');
    expect(await claimOn(w, w.machineAId)).toBeNull();
    expect(stepRowOf(w).status).toBe('pending');
  });

  test('failure mode 3b: running chief steps fill it (cap 1) -> worker step comes up empty', async () => {
    const w = await setupWorld();
    w.s.db
      .update(machineTable)
      .set({ maxConcurrent: 1 })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    insertClaimedOn(w, 'chief');
    const waiting = insertPendingWorkerStep(w);
    expect(await claimOn(w, w.machineAId)).toBeNull();
    expect(stepRowOf(w, waiting).status).toBe('pending');
    expect(stepRowOf(w).status).toBe('pending');
  });

  test('failure mode 4: Agent slot (maxConcurrentTasks=1) -- chief step running -> same-Agent workers and other-thread chiefs all come up empty', async () => {
    const w = await setupWorld();
    w.s.db
      .update(agentTable)
      .set({ maxConcurrentTasks: 1 })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    insertClaimedOn(w, 'chief');
    const waiting = insertPendingWorkerStep(w);
    w.s.db
      .insert(chiefThreadTable)
      .values({
        id: 'chief-demote-thread-2',
        chiefId: w.chiefId,
        userId: w.s.svc.user.id,
        teamId: w.s.team.id,
        title: '第二线程',
        createdAt: 8,
        updatedAt: 8,
        sessionRuntime: 'pi',
        sessionId: '',
        sessionOpenedAt: 8,
        pendingSessionResumeAt: null,
        toolDefHashes: {},
        toolResultHashes: {},
        activeRun: null,
      })
      .run();
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-chief-demote-2',
        buildId: 'chief-demote-thread-2',
        kind: 'chief',
        status: 'pending',
        createdAt: 9,
      })
      .run();
    expect(await claimOn(w, w.machineAId)).toBeNull();
    expect(stepRowOf(w).status).toBe('pending');
    expect(stepRowOf(w, 'step-chief-demote-2').status).toBe('pending');
    expect(stepRowOf(w, waiting).status).toBe('pending');
  });
});

describe('#1260 retired-slot wire surface', () => {
  test('failure mode 6: PATCH carrying only machineId/model/compactionModel -> 400; GET chief record has none of the three keys; orchestration.homeMachineId = bound Agent home machine', async () => {
    const w = await setupWorld();
    for (const body of [
      { machineId: w.machineBId },
      { model: { provider: 'pi', modelId: 'x' } },
      { compactionModel: { provider: 'pi', modelId: 'x' } },
    ]) {
      const res = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/chief`, body);
      expect(res.status).toBe(400);
    }
    const res = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/chief`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const chiefRec = body.chief as Record<string, unknown>;
    expect('machineId' in chiefRec).toBe(false);
    expect('model' in chiefRec).toBe(false);
    expect('compactionModel' in chiefRec).toBe(false);
    const orch = body.orchestration as { homeMachineId: string | null };
    expect(orch.homeMachineId).toBe(w.machineAId);
  });

  test('PATCH agent slot no longer accepts a thinkingLevel override (binding/rebinding still 200)', async () => {
    const w = await setupWorld();
    const res = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/chief`, {
      agent: { agentId: AGENT_ID, thinkingLevel: 'low' },
    });
    expect(res.status).toBe(200);
  });
});

describe('#1260 sweep suspension surface (sweepAbandonedChiefSteps, #1257 suspension semantics)', () => {
  test('failure mode 7: no Agent bound -> suspended waiting for binding (step stays pending, no failure row)', async () => {
    const w = await setupWorld({ bindAgent: false });
    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 700_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorMessage(w)).toBeNull();
  });

  test('failure mode 8: bound Agent has no home machine -> suspended waiting for it to be set (step stays pending)', async () => {
    const w = await setupWorld({ agentMachineId: null });
    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 700_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorMessage(w)).toBeNull();
  });

  test('failure mode 9: home machine offline -> suspended waiting for the machine to return (step stays pending, no failure row)', async () => {
    const w = await setupWorld();
    w.s.db
      .update(machineTable)
      .set({ online: false })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 700_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorMessage(w)).toBeNull();
  });

  test('home machine online and gate open -> untouched (legal queueing)', async () => {
    const w = await setupWorld();
    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 60_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorMessage(w)).toBeNull();
  });
});
