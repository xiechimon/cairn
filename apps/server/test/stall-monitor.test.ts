import {
  CHIEF_NOTICE_KIND,
  chiefNoticeContentSchema,
  type StepActivityReport,
  stepActivityReportSchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { createCoordinatorServerApi } from '../src/coordinator/server-api.js';
import {
  actionProposal,
  build as buildTable,
  chiefMessage,
  chief as chiefTable,
  chiefThread,
  machine as machineTable,
  message as messageTable,
  notification as notificationTable,
  project as projectTable,
  provider as providerTable,
  step as stepTable,
  stopPending,
  todo as todoTable,
} from '../src/db/schema.js';
import { setCoordinatorSignal } from '../src/services/coordinator-signal.js';
import { withFencedTransaction } from '../src/services/machine-deps.js';
import { finishStep, reportActivity, reportTool } from '../src/services/machines.js';
import { createScheduler } from '../src/services/scheduler.js';
import {
  DEAD_RUNNER_GRACE_MS,
  isStepWaitingPermission,
  MISSING_TOOLS_GRACE_MS,
  QUOTA_LOOP_GRACE_MS,
  STALL_STOP_SETTLE_MS,
  sweepStallMonitor,
} from '../src/services/stall-monitor.js';
import { writeQuota } from '../src/services/step-groups/quota.js';
import { writeWorkerQuestion } from '../src/services/worker-question-store.js';
import { sweepWorkerWatchdog } from '../src/services/worker-watchdog.js';
import { bootServer, seedRoute, seedSessionRoute, type TestServer } from './helpers.js';
import { insertStepFixture, readStepFixture } from './step-groups-fixture.js';

const MINUTE = 60_000;
let s: TestServer;
afterEach(() => s?.dispose());

function machineDeps(server: TestServer) {
  return {
    ...server.svc,
    box: server.secretBox,
    reposDir: server.reposDir,
    attachmentsDir: server.attachmentsDir,
    skillsDir: server.skillsDir,
    machineHub: server.machineHub,
  };
}

function seedMachine(
  server: TestServer,
  opts: {
    id: string;
    name: string;
    online: boolean;
    claudeCodeReport?: import('@cairn/shared').ClaudeCodeReport | null;
    capabilities?: Partial<import('@cairn/shared').MachineCapabilities> | null;
  },
): { id: string } {
  const fullCapabilities =
    opts.capabilities === undefined || opts.capabilities === null
      ? opts.capabilities
      : { mcpServers: [], skills: [], ...opts.capabilities };
  server.db
    .insert(machineTable)
    .values(
      readyMachine({
        id: opts.id,
        teamId: server.team.id,
        name: opts.name,
        online: opts.online,
        claudeCodeReport: opts.claudeCodeReport ?? null,
        ...(fullCapabilities !== undefined ? { capabilities: fullCapabilities } : {}),
      }),
    )
    .run();
  return { id: opts.id };
}

function setupProjectAndProvider(server: TestServer, providerId = 'anthropic') {
  server.db
    .insert(projectTable)
    .values({ id: 'proj-1', name: 'demo', teamId: server.team.id })
    .onConflictDoNothing()
    .run();
  server.db
    .insert(providerTable)
    .values({
      id: `prov-${providerId}`,
      teamId: server.team.id,
      providerId,
      label: providerId,
      apiKeyCipher: 'enc',
      baseUrl: 'https://example.invalid',
      api: 'openai-completions',
      compat: {},
      models: [{ id: 'm1', name: 'm1' }],
      createdBy: server.user.id,
      createdAt: 1,
      updatedAt: 1,
    })
    .onConflictDoNothing()
    .run();
}

function seedWorkerStep(
  server: TestServer,
  opts: {
    suffix?: string;
    phase?: 'queued' | 'planning' | 'building' | 'review' | 'done' | 'closed' | 'failed';
    kind?: 'plan' | 'build' | 'session' | 'merge' | 'review' | 'verify';
    status?: 'pending' | 'claimed' | 'done' | 'failed' | 'stopped' | 'waiting_quota';
    machineId?: string | null;
    claimedAt?: number;
    lastHeartbeatAt?: number | null;
    lastProgressAt?: number | null;
    provider?: string;
    fallbackModels?: { provider: string; modelId: string }[];
    prompt?: string;
    archived?: boolean;
    superseded?: boolean;
    ranModel?: { provider: string; modelId: string } | null;
    stallState?: Record<string, unknown> | null;
  } = {},
) {
  const suffix = opts.suffix ?? 'w1';
  const todoId = `todo-${suffix}`;
  const buildId = `build-${suffix}`;
  const stepId = `step-${suffix}`;
  const claimedAt = opts.claimedAt ?? Date.now();
  seedSessionRoute(server, {
    id: `route-${suffix}`,
    provider: opts.provider ?? 'antigravity',
    modelId: 'm1',
    machineId: opts.machineId ?? null,
    fallbackModels: opts.fallbackModels ?? [],
  });
  server.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: server.team.id,
      projectId: 'proj-1',
      title: `Task ${suffix}`,
      phase: opts.phase ?? 'building',
      phaseAt: claimedAt,
      seqNum: 1,
      latestBuildId: opts.superseded ? `build-other-${suffix}` : buildId,
      ...(opts.archived ? { archivedAt: claimedAt } : {}),
    })
    .run();
  server.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: claimedAt,
    })
    .run();
  insertStepFixture(server.db, {
    id: stepId,
    buildId,
    kind: opts.kind ?? 'session',
    machineId: opts.machineId === undefined ? null : opts.machineId,
    status: opts.status ?? 'claimed',
    claimedAt,
    lastHeartbeatAt: opts.lastHeartbeatAt === undefined ? claimedAt : opts.lastHeartbeatAt,
    lastProgressAt: opts.lastProgressAt === undefined ? claimedAt : opts.lastProgressAt,
    prompt: opts.prompt ?? 'do work',
    ranModel:
      opts.ranModel === undefined
        ? opts.provider
          ? { provider: opts.provider, modelId: 'm1' }
          : null
        : opts.ranModel,
    createdAt: claimedAt,
    ...(opts.stallState !== undefined ? { stallState: opts.stallState as never } : {}),
  });
  return { todoId, buildId, stepId, claimedAt };
}

function seedChiefStep(
  server: TestServer,
  opts: {
    suffix?: string;
    threadId?: string;
    machineId?: string | null;
    claimedAt?: number;
    lastHeartbeatAt?: number | null;
    lastProgressAt?: number | null;
    provider?: string;
    fallbackModels?: { provider: string; modelId: string }[];
    prompt?: string;
    ranModel?: { provider: string; modelId: string } | null;
    stallState?: Record<string, unknown> | null;
  } = {},
) {
  const suffix = opts.suffix ?? 'c1';
  const chiefId = `chief-${suffix}`;
  const threadId = opts.threadId ?? `chief-thread-${suffix}`;
  const stepId = `step-${suffix}`;
  const claimedAt = opts.claimedAt ?? Date.now();
  seedRoute(server, 'coordinator', {
    id: `route-chief-${suffix}`,
    provider: opts.provider ?? 'antigravity',
    modelId: 'm1',
    fallbackModels: opts.fallbackModels ?? [],
  });
  server.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: server.user.id,
      teamId: server.team.id,
      watches: [],
      wakes: [],
      createdAt: claimedAt,
    })
    .onConflictDoNothing()
    .run();
  server.db
    .insert(chiefThread)
    .values({
      id: threadId,
      chiefId,
      userId: server.user.id,
      teamId: server.team.id,
      title: 'Chief thread',
      createdAt: claimedAt,
      updatedAt: claimedAt,
      sessionRuntime: 'antigravity',
      sessionId: 'sess-1',
      sessionOpenedAt: claimedAt,
    })
    .onConflictDoNothing()
    .run();
  insertStepFixture(server.db, {
    id: stepId,
    buildId: threadId,
    kind: 'chief',
    machineId: opts.machineId === undefined ? null : opts.machineId,
    status: 'claimed',
    claimedAt,
    lastHeartbeatAt: opts.lastHeartbeatAt === undefined ? claimedAt : opts.lastHeartbeatAt,
    lastProgressAt: opts.lastProgressAt === undefined ? claimedAt : opts.lastProgressAt,
    prompt: opts.prompt ?? '[wake:user] provenance=user\nhi',
    ranModel:
      opts.ranModel === undefined
        ? opts.provider
          ? { provider: opts.provider, modelId: 'm1' }
          : null
        : opts.ranModel,
    createdAt: claimedAt,
    ...(opts.stallState !== undefined ? { stallState: opts.stallState as never } : {}),
  });
  return { chiefId, threadId, stepId, claimedAt };
}

function getStep(server: TestServer, stepId: string) {
  return readStepFixture(server.db, stepId)!;
}

function taskSystemMessages(server: TestServer, buildId: string) {
  return server.db
    .select()
    .from(messageTable)
    .where(and(eq(messageTable.conversationId, buildId), eq(messageTable.role, 'system')))
    .all();
}

function chiefSystemMessages(server: TestServer, threadId: string) {
  return server.db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.threadId, threadId), eq(chiefMessage.role, 'system')))
    .all();
}

describe('stall-monitor', () => {
  test('permission_wait: current-turn ask_user / approval card never interrupts, dedupes per wait, and stale prior card does not block', () => {
    s = bootServer();
    setupProjectAndProvider(s);
    const now = Date.now();
    const machine = seedMachine(s, { id: 'm-perm', name: 'mac', online: true });

    const w = seedWorkerStep(s, {
      suffix: 'perm-w',
      machineId: machine.id,
      provider: 'antigravity',
      claimedAt: now - 7 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 7 * MINUTE,
    });
    writeWorkerQuestion(
      { db: s.db },
      w.buildId,
      'req-w1',
      {
        kind: 'ask_user_question',
        requestId: 'req-w1',
        status: 'pending',
        questions: [{ header: 'Approve', question: 'Allow deploy?', options: [] }],
        answers: null,
      },
      now - 7 * MINUTE,
    );

    const c = seedChiefStep(s, {
      suffix: 'perm-c',
      machineId: null,
      provider: 'antigravity',
      claimedAt: now - 4 * MINUTE,
      lastHeartbeatAt: now - 3 * MINUTE,
      lastProgressAt: now - 4 * MINUTE,
    });
    s.db
      .insert(chiefMessage)
      .values({
        id: 'ask-c1',
        threadId: c.threadId,
        role: 'assistant',
        content: JSON.stringify({
          kind: 'ask_user_question',
          requestId: 'ask-c1',
          status: 'pending',
          questions: [{ header: 'Confirm', question: 'Pick env', options: [] }],
          answers: null,
        }),
        createdAt: now - 4 * MINUTE,
      })
      .run();

    const cCard = seedChiefStep(s, {
      suffix: 'perm-card',
      machineId: null,
      provider: 'antigravity',
      claimedAt: now - 4 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 4 * MINUTE,
    });
    s.db
      .insert(actionProposal)
      .values({
        id: 'prop-old',
        teamId: s.team.id,
        actionId: 'todo.delete',
        targetId: 't-old',
        inputJson: '{}',
        inputHash: 'h-old',
        status: 'pending',
        expiresAt: now + 60_000,
        createdAt: now - 10 * MINUTE,
      })
      .run();
    s.db
      .insert(chiefMessage)
      .values({
        id: 'approval-prop-old',
        threadId: cCard.threadId,
        role: 'assistant',
        content: JSON.stringify({
          kind: 'ask_user_question',
          requestId: 'approval-prop-old',
          status: 'pending',
          questions: [{ header: 'Old', question: 'Old card', options: [] }],
          answers: null,
          askedFor: ['action-proposal:prop-old'],
        }),
        createdAt: now - 10 * MINUTE,
      })
      .run();

    expect(isStepWaitingPermission(s.db, getStep(s, w.stepId))).toBe(true);
    expect(isStepWaitingPermission(s.db, getStep(s, c.stepId))).toBe(true);
    expect(isStepWaitingPermission(s.db, getStep(s, cCard.stepId))).toBe(false);

    const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
    scheduler.tick(now);

    expect(getStep(s, w.stepId).status).toBe('claimed');
    expect(getStep(s, c.stepId).status).toBe('claimed');
    expect(taskSystemMessages(s, w.buildId)).toHaveLength(1);
    expect(chiefSystemMessages(s, c.threadId)).toHaveLength(1);
    expect(getStep(s, cCard.stepId).status).toBe('pending');
    scheduler.stop();

    sweepStallMonitor(s.svc, now + MINUTE);
    expect(taskSystemMessages(s, w.buildId)).toHaveLength(1);
    expect(chiefSystemMessages(s, c.threadId)).toHaveLength(1);

    writeWorkerQuestion(
      { db: s.db },
      w.buildId,
      'req-w2',
      {
        kind: 'ask_user_question',
        requestId: 'req-w2',
        status: 'pending',
        questions: [{ header: 'Next', question: 'Second question', options: [] }],
        answers: null,
      },
      now + MINUTE,
    );
    sweepStallMonitor(s.svc, now + 2 * MINUTE);
    expect(taskSystemMessages(s, w.buildId)).toHaveLength(2);

    const wEarly = seedWorkerStep(s, {
      suffix: 'perm-early',
      machineId: machine.id,
      provider: 'antigravity',
      claimedAt: now - 45_000,
      lastHeartbeatAt: now,
      lastProgressAt: now - 45_000,
    });
    writeWorkerQuestion(
      { db: s.db },
      wEarly.buildId,
      'req-early',
      {
        kind: 'ask_user_question',
        requestId: 'req-early',
        status: 'pending',
        questions: [{ header: 'Confirm', question: 'Proceed?', options: [] }],
        answers: null,
      },
      now - 45_000,
    );
    reportActivity(machineDeps(s), machine.id, wEarly.stepId, {
      phase: 'tool',
      stallSignal: 'missing_tools',
      detail: 'Cairn host tools did not attach',
    } as StepActivityReport);
    const earlyAt = getStep(s, wEarly.stepId).stallState?.activity?.firstSeenAt ?? now;
    sweepStallMonitor(s.svc, earlyAt + MISSING_TOOLS_GRACE_MS + 5_000);
    expect(getStep(s, wEarly.stepId).status).toBe('claimed');
  });

  test('missing_tools: signal and legacy reportTool fallback recover once with freshSession, clear on success, and fail on repeat', () => {
    s = bootServer();
    setupProjectAndProvider(s);
    const now = Date.now();
    const machine = seedMachine(s, {
      id: 'm-tools',
      name: 'mac',
      online: true,
      capabilities: { claimGeneration: true },
    });
    const stops: string[] = [];
    s.machineHub.subscribe(s.team.id, (ev) => {
      if (ev.type === 'stop') stops.push(ev.stepId);
    });

    const w = seedWorkerStep(s, {
      suffix: 'tools-1',
      machineId: machine.id,
      provider: 'antigravity',
      claimedAt: now - MISSING_TOOLS_GRACE_MS - 5_000,
      lastHeartbeatAt: now,
      lastProgressAt: now - MISSING_TOOLS_GRACE_MS - 5_000,
    });
    reportTool(machineDeps(s), machine.id, w.stepId, {
      id: 'tc-1',
      name: 'mcp__cairn__todos',
      arguments: {},
      result: 'unknown tool mcp__cairn__todos',
      isError: true,
    });
    reportTool(machineDeps(s), machine.id, w.stepId, {
      id: 'tc-2',
      name: 'mcp__cairn__todos',
      arguments: {},
      result: [{ text: 'ok' }],
      isError: false,
    });
    expect(getStep(s, w.stepId).stallState?.activity).toBeUndefined();

    reportActivity(machineDeps(s), machine.id, w.stepId, {
      phase: 'tool',
      stallSignal: 'missing_tools',
      detail: 'Cairn host tools did not attach',
    } as StepActivityReport);
    const firstAt = getStep(s, w.stepId).stallState?.activity?.firstSeenAt;
    expect(firstAt).toBeTypeOf('number');

    sweepStallMonitor(s.svc, (firstAt ?? now) + MISSING_TOOLS_GRACE_MS - 1_000);
    expect(getStep(s, w.stepId).status).toBe('claimed');

    sweepStallMonitor(s.svc, (firstAt ?? now) + MISSING_TOOLS_GRACE_MS + 1_000);
    const recovered = getStep(s, w.stepId);
    expect(recovered.status).toBe('pending');
    expect(recovered.freshSession).toBe(true);
    expect(recovered.machineId).toBeNull();
    expect(recovered.stallState?.recoveryCount).toBe(1);
    expect(recovered.stallState?.lastRecoveredFromMachineId).toBe(machine.id);
    expect(stops).toContain(w.stepId);
    expect(taskSystemMessages(s, w.buildId)).toHaveLength(1);

    s.db
      .update(stepTable)
      .set({
        status: 'claimed',
        machineId: machine.id,
        claimedAt: (firstAt ?? now) + MISSING_TOOLS_GRACE_MS + 2_000,
        lastHeartbeatAt: (firstAt ?? now) + MISSING_TOOLS_GRACE_MS + 2_000,
        lastProgressAt: (firstAt ?? now) + MISSING_TOOLS_GRACE_MS + 2_000,
        holdReason: null,
        holdUntil: null,
      })
      .where(eq(stepTable.id, w.stepId))
      .run();
    reportActivity(machineDeps(s), machine.id, w.stepId, {
      phase: 'tool',
      stallSignal: 'missing_tools',
      detail: 'still missing',
    } as StepActivityReport);
    const secondFirstAt = getStep(s, w.stepId).stallState?.activity?.firstSeenAt ?? 0;
    expect(secondFirstAt).toBeGreaterThan(0);
    sweepStallMonitor(s.svc, secondFirstAt + MISSING_TOOLS_GRACE_MS + 1_000);
    expect(getStep(s, w.stepId).status).toBe('failed');
    expect(taskSystemMessages(s, w.buildId).length).toBeGreaterThanOrEqual(2);
  });

  test('quota: switches to eligible fallback clearing ranModel, parks without fallback, ignores bare attempt>=2, preserves firstSeenAt', () => {
    s = bootServer();
    setupProjectAndProvider(s, 'anthropic');
    setupProjectAndProvider(s, 'openai');
    const now = Date.now();
    const machine = seedMachine(s, {
      id: 'm-quota',
      name: 'mac',
      online: true,
      claudeCodeReport: { installed: true, hostname: 'mac', models: [] },
      capabilities: { claimGeneration: true },
    });

    const wFallback = seedWorkerStep(s, {
      suffix: 'q-fb',
      machineId: machine.id,
      provider: 'anthropic',
      fallbackModels: [{ provider: 'openai', modelId: 'm1' }],
      claimedAt: now - 2 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 2 * MINUTE,
      stallState: { recoveryCount: 1 },
    });
    reportActivity(machineDeps(s), machine.id, wFallback.stepId, {
      phase: 'retrying',
      attempt: 1,
      stallSignal: 'quota',
      detail: '429 quota exceeded',
    } as StepActivityReport);
    const qFirstAt = getStep(s, wFallback.stepId).stallState?.activity?.firstSeenAt ?? 0;
    expect(qFirstAt).toBeGreaterThan(0);
    reportActivity(machineDeps(s), machine.id, wFallback.stepId, {
      phase: 'retrying',
      attempt: 2,
      stallSignal: 'quota',
      detail: '429 quota exceeded again',
    } as StepActivityReport);
    expect(getStep(s, wFallback.stepId).stallState?.activity?.firstSeenAt).toBe(qFirstAt);

    sweepStallMonitor(s.svc, qFirstAt + QUOTA_LOOP_GRACE_MS + 1_000);
    const fbStep = getStep(s, wFallback.stepId);
    expect(fbStep.status).toBe('pending');
    expect(fbStep.fallback?.model).toEqual({ provider: 'openai', modelId: 'm1' });
    expect(fbStep.ranModel).toBeNull();
    expect(fbStep.freshSession).toBe(true);
    expect(taskSystemMessages(s, wFallback.buildId)).toHaveLength(1);

    const wNoFb = seedWorkerStep(s, {
      suffix: 'q-nofb',
      machineId: machine.id,
      provider: 'anthropic',
      claimedAt: now - 2 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 2 * MINUTE,
    });
    reportActivity(machineDeps(s), machine.id, wNoFb.stepId, {
      phase: 'retrying',
      attempt: 2,
      stallSignal: 'capacity',
      detail: 'overloaded',
    } as StepActivityReport);
    const noFbFirst = getStep(s, wNoFb.stepId).stallState?.activity?.firstSeenAt ?? 0;
    expect(noFbFirst).toBeGreaterThan(0);
    sweepStallMonitor(s.svc, noFbFirst + QUOTA_LOOP_GRACE_MS + 1_000);
    const parkedWorker = getStep(s, wNoFb.stepId);
    expect(parkedWorker.status).toBe('waiting_quota');
    expect(parkedWorker.stallState?.lastRecoveredAt).toBeTypeOf('number');
    expect(parkedWorker.stallState?.lastRecoveredFromMachineId).toBe(machine.id);
    expect(taskSystemMessages(s, wNoFb.buildId)).toHaveLength(1);

    const cNoFb = seedChiefStep(s, {
      suffix: 'q-chief',
      machineId: machine.id,
      provider: 'anthropic',
      claimedAt: now - 2 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 2 * MINUTE,
    });
    reportActivity(machineDeps(s), machine.id, cNoFb.stepId, {
      phase: 'retrying',
      attempt: 2,
      stallSignal: 'quota',
      detail: 'limit reached',
    } as StepActivityReport);
    const chiefFirst = getStep(s, cNoFb.stepId).stallState?.activity?.firstSeenAt ?? 0;
    expect(chiefFirst).toBeGreaterThan(0);
    sweepStallMonitor(s.svc, chiefFirst + QUOTA_LOOP_GRACE_MS + 1_000);
    const parkedChief = getStep(s, cNoFb.stepId);
    expect(parkedChief.status).toBe('pending');
    expect(parkedChief.holdReason).toBe('quota');
    expect(
      (parkedChief.holdUntil ?? 0) - (chiefFirst + QUOTA_LOOP_GRACE_MS + 1_000),
    ).toBeGreaterThanOrEqual(STALL_STOP_SETTLE_MS);
    expect(parkedChief.stallState?.lastRecoveredAt).toBeTypeOf('number');
    expect(parkedChief.stallState?.lastRecoveredFromMachineId).toBe(machine.id);
    expect(chiefSystemMessages(s, cNoFb.threadId)).toHaveLength(1);

    const wPlainRetry = seedWorkerStep(s, {
      suffix: 'q-plain',
      machineId: machine.id,
      provider: 'anthropic',
      claimedAt: now - 2 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 2 * MINUTE,
    });
    reportActivity(machineDeps(s), machine.id, wPlainRetry.stepId, {
      phase: 'retrying',
      attempt: 3,
    });
    const plainFirst = getStep(s, wPlainRetry.stepId).stallState?.activity?.firstSeenAt ?? 0;
    expect(plainFirst).toBeGreaterThan(0);
    sweepStallMonitor(s.svc, plainFirst + QUOTA_LOOP_GRACE_MS + 1_000);
    expect(getStep(s, wPlainRetry.stepId).status).toBe('claimed');
  });

  test('dead_turn: respects 60s grace and admitPresence reconnect, requeues once, and terminates on repeat', () => {
    s = bootServer();
    setupProjectAndProvider(s);
    const now = Date.now();
    const machine = seedMachine(s, {
      id: 'm-dead',
      name: 'mac',
      online: true,
      capabilities: { claimGeneration: true },
    });

    s.machineHub.subscribeMachine(s.team.id, machine.id, () => {});
    const connId = s.machineHub.connectionId(machine.id)!;
    s.machineHub.dropConnection(machine.id, connId, () => {});

    const w = seedWorkerStep(s, {
      suffix: 'dead-1',
      machineId: machine.id,
      provider: 'antigravity',
      claimedAt: now - 30_000,
      lastHeartbeatAt: now - 30_000,
      lastProgressAt: now - 30_000,
    });

    sweepStallMonitor(s.svc, now);
    expect(getStep(s, w.stepId).status).toBe('claimed');

    s.machineHub.admitPresence(machine.id, connId);
    sweepStallMonitor(s.svc, now + DEAD_RUNNER_GRACE_MS);
    expect(getStep(s, w.stepId).status).toBe('claimed');
    s.machineHub.cancelGrace(machine.id);

    s.db.update(machineTable).set({ online: false }).where(eq(machineTable.id, machine.id)).run();
    sweepStallMonitor(s.svc, now + DEAD_RUNNER_GRACE_MS);
    expect(getStep(s, w.stepId).status).toBe('pending');
    expect(getStep(s, w.stepId).holdReason).toBeNull();
    expect(getStep(s, w.stepId).stallState?.recoveryCount).toBe(1);
    expect(taskSystemMessages(s, w.buildId)).toHaveLength(1);

    s.db
      .update(stepTable)
      .set({
        status: 'claimed',
        machineId: machine.id,
        claimedAt: now + DEAD_RUNNER_GRACE_MS + 1_000,
        lastHeartbeatAt: now + DEAD_RUNNER_GRACE_MS + 1_000,
        lastProgressAt: now + DEAD_RUNNER_GRACE_MS + 1_000,
      })
      .where(eq(stepTable.id, w.stepId))
      .run();
    sweepStallMonitor(s.svc, now + 2 * DEAD_RUNNER_GRACE_MS + 2_000);
    expect(getStep(s, w.stepId).status).toBe('failed');
  });

  test('silent_turn: runtime-specific windows, in-server Coordinator restart, cap at 1 restart, and progress clears dedupe', () => {
    s = bootServer();
    setupProjectAndProvider(s);
    const now = Date.now() - 8 * MINUTE;
    const machine = seedMachine(s, { id: 'm-silent', name: 'mac', online: true });

    const agyW = seedWorkerStep(s, {
      suffix: 'sil-agy',
      machineId: machine.id,
      provider: 'antigravity',
      claimedAt: now - 7 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 7 * MINUTE,
    });
    const claudeW = seedWorkerStep(s, {
      suffix: 'sil-claude',
      machineId: machine.id,
      provider: 'claude-code',
      claimedAt: now - 7 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 7 * MINUTE,
    });
    const unknownW = seedWorkerStep(s, {
      suffix: 'sil-unknown',
      machineId: machine.id,
      provider: undefined,
      ranModel: null,
      claimedAt: now - 10 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 10 * MINUTE,
    });
    const activeW = seedWorkerStep(s, {
      suffix: 'sil-active',
      machineId: machine.id,
      provider: 'antigravity',
      claimedAt: now - 10 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 1 * MINUTE,
    });
    const chiefInServer = seedChiefStep(s, {
      suffix: 'sil-chief',
      machineId: null,
      provider: 'antigravity',
      claimedAt: now - 4 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 4 * MINUTE,
    });

    sweepStallMonitor(s.svc, now);
    expect(getStep(s, agyW.stepId).status).toBe('pending');
    expect(getStep(s, agyW.stepId).freshSession).toBe(true);
    expect(getStep(s, agyW.stepId).holdReason).toBe('stall_recovery');
    expect(getStep(s, claudeW.stepId).status).toBe('claimed');
    expect(getStep(s, unknownW.stepId).status).toBe('claimed');
    expect(getStep(s, activeW.stepId).status).toBe('claimed');
    expect(getStep(s, chiefInServer.stepId).status).toBe('pending');
    expect(getStep(s, chiefInServer.stepId).holdReason).toBe('stall_recovery');

    sweepStallMonitor(s.svc, now + 6 * MINUTE);
    expect(getStep(s, unknownW.stepId).status).toBe('pending');

    s.db
      .update(stepTable)
      .set({
        status: 'claimed',
        machineId: machine.id,
        claimedAt: now + 10_000,
        lastHeartbeatAt: now + 10_000,
        lastProgressAt: now + 10_000,
        holdReason: null,
        holdUntil: null,
      })
      .where(eq(stepTable.id, agyW.stepId))
      .run();
    s.db.transaction((tx) =>
      writeQuota(tx, agyW.stepId, { ranModel: { provider: 'antigravity', modelId: 'm1' } }),
    );
    const again = now + 7 * MINUTE;
    s.db
      .update(stepTable)
      .set({ lastHeartbeatAt: again })
      .where(eq(stepTable.id, agyW.stepId))
      .run();
    sweepStallMonitor(s.svc, again);
    expect(getStep(s, agyW.stepId).status).toBe('claimed');
    const countBefore = taskSystemMessages(s, agyW.buildId).length;
    sweepStallMonitor(s.svc, again + MINUTE);
    expect(taskSystemMessages(s, agyW.buildId)).toHaveLength(countBefore);

    reportTool(machineDeps(s), machine.id, agyW.stepId, {
      id: 'tc-resume',
      name: 'bash',
      arguments: {},
      result: 'ok',
      isError: false,
    });
    expect(getStep(s, agyW.stepId).stallState?.reportedFingerprint).toBeUndefined();
    const laterStall = Date.now() + 7 * MINUTE;
    s.db
      .update(stepTable)
      .set({ lastHeartbeatAt: laterStall })
      .where(eq(stepTable.id, agyW.stepId))
      .run();
    sweepStallMonitor(s.svc, laterStall);
    expect(taskSystemMessages(s, agyW.buildId).length).toBeGreaterThan(countBefore);
  });

  test('concurrency & fencing: stopPending wins, rollback emits zero events, late runner done returns 409, and Coordinator forGeneration fences all writes', async () => {
    s = bootServer();
    setupProjectAndProvider(s);
    const now = Date.now();
    const machine = seedMachine(s, {
      id: 'm-conc',
      name: 'mac',
      online: true,
      capabilities: { claimGeneration: true },
    });

    const userStopped = seedWorkerStep(s, {
      suffix: 'conc-stop',
      machineId: machine.id,
      provider: 'antigravity',
      claimedAt: now - 7 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 7 * MINUTE,
    });
    s.db
      .insert(stopPending)
      .values({
        conversationId: userStopped.buildId,
        stepId: userStopped.stepId,
        discard: false,
        createdAt: now,
      })
      .run();
    sweepStallMonitor(s.svc, now);
    expect(getStep(s, userStopped.stepId).status).toBe('claimed');

    const wLate = seedWorkerStep(s, {
      suffix: 'conc-late',
      machineId: machine.id,
      provider: 'antigravity',
      claimedAt: now - 7 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 7 * MINUTE,
    });
    const oldGen = wLate.claimedAt;
    sweepStallMonitor(s.svc, now);
    expect(getStep(s, wLate.stepId).holdReason).toBe('stall_recovery');

    await expect(
      finishStep(machineDeps(s), 'other-machine', wLate.stepId, {
        status: 'stopped',
        generation: oldGen,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(getStep(s, wLate.stepId).holdReason).toBe('stall_recovery');

    await expect(
      finishStep(machineDeps(s), machine.id, wLate.stepId, { status: 'stopped' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(getStep(s, wLate.stepId).holdReason).toBe('stall_recovery');

    await expect(
      finishStep(machineDeps(s), machine.id, wLate.stepId, {
        status: 'stopped',
        generation: oldGen,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(getStep(s, wLate.stepId).holdReason).toBeNull();

    const coordSignals: string[] = [];
    setCoordinatorSignal((threadId, kind) => coordSignals.push(`${threadId}:${kind}`));
    const cRollback = seedChiefStep(s, {
      suffix: 'conc-rollback',
      machineId: null,
      provider: 'antigravity',
      claimedAt: now - 4 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 4 * MINUTE,
    });
    expect(() =>
      withFencedTransaction(s.svc, (txDeps) => {
        sweepStallMonitor(txDeps, now);
        throw new Error('force rollback');
      }),
    ).toThrow('force rollback');
    expect(getStep(s, cRollback.stepId).status).toBe('claimed');
    expect(coordSignals).toHaveLength(0);
    setCoordinatorSignal(() => {});

    const events: unknown[] = [];
    s.convHub.subscribe(wLate.buildId, {
      nextSeq: () => 1,
      send: (ev) => {
        events.push(ev);
        return Promise.resolve();
      },
    });
    expect(() =>
      withFencedTransaction(s.svc, (txDeps) => {
        txDeps.convHub?.publishMessage(wLate.buildId, {
          id: 'ghost',
          role: 'system',
          content: 'ghost',
          createdAt: now,
          actor: null,
        });
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(events).toHaveLength(0);

    const c = seedChiefStep(s, {
      suffix: 'conc-chief',
      machineId: null,
      provider: 'antigravity',
      claimedAt: now - 4 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 4 * MINUTE,
    });
    const baseApi = createCoordinatorServerApi({
      db: s.db,
      hub: s.hub,
      machineHub: s.machineHub,
      box: s.secretBox,
      user: s.user,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
      convHub: s.convHub,
    });
    const genApi = baseApi.forGeneration!(c.stepId, c.claimedAt);
    sweepStallMonitor(s.svc, now);
    await expect(genApi.stop(c.stepId)).resolves.toBe(false);
    await expect(
      genApi.transcriptRow(c.stepId, {
        id: 'late-row',
        role: 'assistant',
        content: 'stale output',
        createdAt: now,
      }),
    ).rejects.toThrow();
    await expect(
      genApi.done(c.stepId, {
        status: 'success',
        generation: c.claimedAt,
        usage: [{ model: 'antigravity/m1', input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }],
      }),
    ).rejects.toThrow();
    expect(
      s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'late-row')).get(),
    ).toBeUndefined();
  });

  test('exclusions, watchdog dedupe, and web mapper rendering', () => {
    s = bootServer();
    setupProjectAndProvider(s);
    const now = Date.now();
    const machine = seedMachine(s, { id: 'm-excl', name: 'mac', online: true });

    const localMerge = seedWorkerStep(s, {
      suffix: 'local-merge',
      kind: 'merge',
      machineId: machine.id,
      provider: 'antigravity',
      prompt: 'run "local-merge" now',
      claimedAt: now - 7 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 7 * MINUTE,
    });
    const archived = seedWorkerStep(s, {
      suffix: 'arch',
      machineId: machine.id,
      provider: 'antigravity',
      archived: true,
      claimedAt: now - 7 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 7 * MINUTE,
    });
    const closed = seedWorkerStep(s, {
      suffix: 'closed',
      phase: 'closed',
      machineId: machine.id,
      provider: 'antigravity',
      claimedAt: now - 7 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 7 * MINUTE,
    });
    const superseded = seedWorkerStep(s, {
      suffix: 'super',
      machineId: machine.id,
      provider: 'antigravity',
      superseded: true,
      claimedAt: now - 7 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 7 * MINUTE,
    });
    const digest = seedChiefStep(s, {
      suffix: 'digest',
      threadId: 'chief-digest-1',
      machineId: null,
      provider: 'antigravity',
      claimedAt: now - 7 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 7 * MINUTE,
    });

    sweepStallMonitor(s.svc, now);
    expect(getStep(s, localMerge.stepId).status).toBe('claimed');
    expect(taskSystemMessages(s, localMerge.buildId)).toHaveLength(1);
    expect(taskSystemMessages(s, archived.buildId)).toHaveLength(0);
    expect(taskSystemMessages(s, closed.buildId)).toHaveLength(0);
    expect(taskSystemMessages(s, superseded.buildId)).toHaveLength(0);
    expect(chiefSystemMessages(s, digest.threadId)).toHaveLength(0);

    const wReported = seedWorkerStep(s, {
      suffix: 'wd-dedupe',
      machineId: machine.id,
      provider: 'antigravity',
      claimedAt: now - 35 * MINUTE,
      lastHeartbeatAt: now,
      lastProgressAt: now - 35 * MINUTE,
      stallState: { recoveryCount: 1, reportedAt: now - 10 * MINUTE, reportedFingerprint: 'fp' },
    });
    expect(sweepWorkerWatchdog(s.svc, now)).toBe(0);
    expect(
      s.db
        .select()
        .from(notificationTable)
        .where(eq(notificationTable.entityId, wReported.todoId))
        .all(),
    ).toHaveLength(0);

    expect(
      chiefNoticeContentSchema.safeParse({
        kind: CHIEF_NOTICE_KIND,
        message: '对话已超过 3 分钟无进展，已自动重启本轮。',
        provenance: 'stall-monitor',
      }).success,
    ).toBe(true);
    expect(
      stepActivityReportSchema.safeParse({ phase: 'retrying', stallSignal: 'quota' }).success,
    ).toBe(true);
  });
});
