import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  chiefMessage as chiefMessageTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { BUILD_ABANDONED_STEP_MS, sweepAbandonedBuildSteps } from '../src/services/builds.js';
import { sweepAbandonedChiefSteps } from '../src/services/chief.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import { toTodoRecord } from '../src/services/todos.js';
import { bootServer, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

let seqCounter = 9_900;

interface ReasonWorld {
  s: TestServer;
  teamId: string;
  projectId: string;
  base: number;
}

function makeWorld(): ReasonWorld {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const base = Date.now();
  const projectId = 'proj-capreason';
  s.db.insert(projectTable).values({ id: projectId, name: 'capreason', teamId: s.team.id }).run();
  return { s, teamId: s.team.id, projectId, base };
}

function insertMachine(
  w: ReasonWorld,
  opts: {
    id: string;
    online?: boolean;
    runtimes?: string[];
    capabilities?: { mcpServers: string[]; skills: string[] } | null;
    claudeModels?: string[];
  },
): void {
  w.s.db
    .insert(machineTable)
    .values({
      id: opts.id,
      teamId: w.teamId,
      name: opts.id,
      online: opts.online ?? true,
      enabledRuntimes: opts.runtimes ?? ['pi'],
      capabilities: opts.capabilities === undefined ? null : opts.capabilities,
      ...(opts.claudeModels !== undefined
        ? {
            claudeCodeReport: {
              installed: true,
              hostname: opts.id,
              models: opts.claudeModels.map((id) => ({ id, name: id })),
            },
          }
        : {}),
      maxConcurrent: 3,
    })
    .run();
}

function insertAgent(
  w: ReasonWorld,
  opts: { id: string; requiredCapabilities?: { mcpServers?: string[]; models?: string[] } | null },
): void {
  w.s.db
    .insert(agentTable)
    .values({
      id: opts.id,
      teamId: w.teamId,
      displayName: opts.id,
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
      requiredCapabilities: opts.requiredCapabilities ?? null,
    })
    .run();
}

function insertPendingWorkerStep(
  w: ReasonWorld,
  opts: { agentId: string; homeMachineId?: string | null; createdAgo?: number },
): {
  id: string;
  createdAt: number;
  homeMachineId: string | null;
  buildId: string;
  todoId: string;
} {
  const suffix = Math.random().toString(36).slice(2, 8);
  seqCounter += 1;
  const createdAt = w.base - (opts.createdAgo ?? 0);
  const todoId = `todo-cr-${suffix}`;
  const buildId = `build-cr-${suffix}`;
  const id = `step-cr-${suffix}`;
  const homeMachineId = opts.homeMachineId ?? null;
  w.s.db
    .update(agentTable)
    .set({ machineId: homeMachineId })
    .where(eq(agentTable.id, opts.agentId))
    .run();
  w.s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: w.teamId,
      projectId: w.projectId,
      seqNum: seqCounter,
      title: `pending reason ${suffix}`,
      spec: '探针',
      phase: 'queued',
      phaseAt: createdAt,
      assignment: { plan: null, build: { agentId: opts.agentId } },
    })
    .run();
  w.s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt,
    })
    .run();
  w.s.db
    .insert(stepTable)
    .values({
      id,
      buildId,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt,
    })
    .run();
  return { id, createdAt, homeMachineId, buildId, todoId };
}

function insertPendingChiefStep(
  w: ReasonWorld,
  opts: { agentId: string; homeMachineId?: string | null; createdAgo?: number },
): { id: string; createdAt: number; homeMachineId: string | null; threadId: string } {
  const suffix = Math.random().toString(36).slice(2, 8);
  const createdAt = w.base - (opts.createdAgo ?? 0);
  const chiefId = `chief-cr-${suffix}`;
  const threadId = `chief-thread-cr-${suffix}`;
  const id = `step-chief-cr-${suffix}`;
  const homeMachineId = opts.homeMachineId ?? null;
  w.s.db
    .update(agentTable)
    .set({ machineId: homeMachineId })
    .where(eq(agentTable.id, opts.agentId))
    .run();
  w.s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: w.s.user.id,
      teamId: w.teamId,
      agentId: opts.agentId,
      charter: '',
      createdAt,
    })
    .run();
  w.s.db
    .insert(chiefThreadTable)
    .values({
      id: threadId,
      chiefId,
      userId: w.s.user.id,
      teamId: w.teamId,
      title: 'pending reason chief',
      createdAt,
      updatedAt: createdAt,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: createdAt,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: { phase: 'chief' },
    })
    .run();
  w.s.db
    .insert(stepTable)
    .values({
      id,
      buildId: threadId,
      kind: 'chief',
      machineId: null,
      status: 'pending',
      prompt: '帮我看看',
      createdAt,
    })
    .run();
  return { id, createdAt, homeMachineId, threadId };
}

function buildRowOf(w: ReasonWorld, buildId: string) {
  return w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
}

function stepRowOf(w: ReasonWorld, stepId: string) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
}

describe('#1251 queue projection blocked bit (worker steps)', () => {
  test('failure mode 1: all online machines missing the capability -> capability-missing + readable missing items', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r1', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-r1a', capabilities: { mcpServers: ['ctx'], skills: [] } });
    insertMachine(w, { id: 'm-r1b', capabilities: { mcpServers: [], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-r1', homeMachineId: 'm-r1a' });
    const info = stepQueueProjector(w.s.db, w.teamId).project(target);
    expect(info?.blocked).toEqual({
      kind: 'capability-missing',
      missing: ['MCP server "figma"'],
    });
    expect(info?.position).toBe(1);
  });

  test('failure mode 2: team has zero online machines -> machine-offline (agents without capability requirements also get it)', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r2' });
    insertMachine(w, { id: 'm-r2', online: false, capabilities: { mcpServers: [], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-r2', homeMachineId: 'm-r2' });
    const info = stepQueueProjector(w.s.db, w.teamId).project(target);
    expect(info?.blocked).toEqual({ kind: 'machine-offline', missing: [] });
  });

  test('failure mode 3: a capable online machine exists -> blocked absent (normal queueing)', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r3', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-r3a', capabilities: { mcpServers: ['ctx'], skills: [] } });
    insertMachine(w, { id: 'm-r3b', capabilities: { mcpServers: ['figma'], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-r3', homeMachineId: 'm-r3b' });
    expect(stepQueueProjector(w.s.db, w.teamId).project(target)?.blocked).toBeUndefined();
  });

  test('failure mode 4: online machine never reported a snapshot -> blocked absent (fail-open display surface same law)', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r4', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-r4', capabilities: null });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-r4', homeMachineId: 'm-r4' });
    expect(stepQueueProjector(w.s.db, w.teamId).project(target)?.blocked).toBeUndefined();
  });

  test('failure mode 5: home machine offline -> machine-offline; home machine online but missing capability -> capability-missing', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r5a', requiredCapabilities: { mcpServers: ['figma'] } });
    insertAgent(w, { id: 'agent-r5b', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, {
      id: 'm-r5-off',
      online: false,
      capabilities: { mcpServers: [], skills: [] },
    });
    insertMachine(w, { id: 'm-r5-on', capabilities: { mcpServers: [], skills: [] } });
    const offlineTarget = insertPendingWorkerStep(w, {
      agentId: 'agent-r5a',
      homeMachineId: 'm-r5-off',
    });
    const onlineTarget = insertPendingWorkerStep(w, {
      agentId: 'agent-r5b',
      homeMachineId: 'm-r5-on',
    });
    const projector = stepQueueProjector(w.s.db, w.teamId);
    expect(projector.project(offlineTarget)?.blocked).toEqual({
      kind: 'machine-offline',
      missing: [],
    });
    expect(projector.project(onlineTarget)?.blocked).toEqual({
      kind: 'capability-missing',
      missing: ['MCP server "figma"'],
    });
  });

  test('failure mode 6: runtime gate block does not impersonate a capability cause -> blocked absent (existing seam keeps its presentation)', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r6', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-r6', runtimes: [], capabilities: { mcpServers: [], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-r6', homeMachineId: 'm-r6' });
    expect(stepQueueProjector(w.s.db, w.teamId).project(target)?.blocked).toBeUndefined();
  });

  test('failure mode 1 addendum: models dimension missing items named the same shape', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-r7', requiredCapabilities: { models: ['glm-5.3'] } });
    insertMachine(w, {
      id: 'm-r7',
      capabilities: { mcpServers: [], skills: [] },
      claudeModels: ['other-model'],
    });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-r7', homeMachineId: 'm-r7' });
    expect(stepQueueProjector(w.s.db, w.teamId).project(target)?.blocked).toEqual({
      kind: 'capability-missing',
      missing: ['model "glm-5.3"'],
    });
  });
});

describe('#1251 queue projection blocked bit (chief turns)', () => {
  test('failure mode 7: bound Agent missing capability -> turnQueue projection blocked same shape', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-c1', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-c1', capabilities: { mcpServers: [], skills: [] } });
    insertPendingChiefStep(w, { agentId: 'agent-c1', homeMachineId: 'm-c1' });
    const projector = stepQueueProjector(w.s.db, w.teamId);
    const target = projector.pendingChiefOf(w.s.db.select().from(chiefThreadTable).get()!.id);
    expect(target).not.toBeNull();
    const info = target === null ? null : projector.project(target);
    expect(info?.blocked).toEqual({
      kind: 'capability-missing',
      missing: ['MCP server "figma"'],
    });
  });
});

describe('#1251x#1257 capability-block suspension: sweep does no failure wrap-up, visible state lands on waitingOn + queue.blocked', () => {
  test('failure mode 8: pinned online capability block -> sweep does no failure wrap-up past any grace period (suspended waiting for a machine)', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-s1', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-s1', capabilities: { mcpServers: ['ctx'], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-s1', homeMachineId: 'm-s1' });

    sweepAbandonedBuildSteps(w.s.svc, w.base + BUILD_ABANDONED_STEP_MS * 10);
    expect(stepRowOf(w, target.id).status).toBe('pending');
    expect(buildRowOf(w, target.buildId).errorMessage).toBeNull();
  });

  test('failure mode 9: todo waitingOn derived = waiting for machine suspension; disappears once capability is filled', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-s2', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-s2', capabilities: { mcpServers: ['ctx'], skills: [] } });
    const target = insertPendingWorkerStep(w, { agentId: 'agent-s2', homeMachineId: 'm-s2' });
    w.s.db
      .update(todoTable)
      .set({ latestBuildId: target.buildId })
      .where(eq(todoTable.id, target.todoId))
      .run();
    const todoRow = () =>
      w.s.db.select().from(todoTable).where(eq(todoTable.id, target.todoId)).get()!;

    expect(toTodoRecord(w.s.svc, todoRow()).waitingOn).toEqual({ on: 'machine', retryAt: null });

    w.s.db
      .update(machineTable)
      .set({ capabilities: { mcpServers: ['ctx', 'figma'], skills: [] } })
      .where(eq(machineTable.id, 'm-s2'))
      .run();
    expect(toTodoRecord(w.s.svc, todoRow()).waitingOn).toBeUndefined();
  });

  test('failure mode 7 (chief): a capability-blocked pending turn is not touched by sweep (same suspension law)', () => {
    const w = makeWorld();
    insertAgent(w, { id: 'agent-s3', requiredCapabilities: { mcpServers: ['figma'] } });
    insertMachine(w, { id: 'm-s3', capabilities: { mcpServers: [], skills: [] } });
    const target = insertPendingChiefStep(w, {
      agentId: 'agent-s3',
      homeMachineId: 'm-s3',
    });
    sweepAbandonedChiefSteps(w.s.svc, w.base + BUILD_ABANDONED_STEP_MS * 10);
    expect(stepRowOf(w, target.id).status).toBe('pending');
    const errRow = w.s.db
      .select()
      .from(chiefMessageTable)
      .where(eq(chiefMessageTable.id, `chief-err-${target.id}`))
      .get();
    expect(errRow).toBeUndefined();
  });
});
