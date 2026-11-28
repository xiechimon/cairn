import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  build as buildTable,
  chiefMessage as chiefMessageTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  memoryCorrection as memoryCorrectionTable,
  message as messageTable,
  project as projectTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { claimPendingChiefStep } from '../src/services/coordinator-steps.js';
import { claudeCodeUsable, doubaoUsable } from '../src/services/dispatch-eligibility.js';
import { createDoubaoSubscription } from '../src/services/doubao-subscriptions.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { priorSessionOf } from '../src/services/machine-routing.js';
import { claimStep, finishStep } from '../src/services/machines.js';
import { injectMemoryDocuments } from '../src/services/memory.js';
import { executeMemoryToolForStep } from '../src/services/memory-corrections.js';
import { executeMemoryDocumentTool } from '../src/services/memory-documents.js';
import {
  defaultSessionChoice,
  profileForStep,
  upsertRoutingRule,
} from '../src/services/routing-rules.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import {
  bootServer,
  insertMachine,
  postProject,
  req,
  seedRoute,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
  setCoordinatorInServer(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function bootFastServer(opts: Parameters<typeof bootServer>[0] = {}): TestServer {
  const root = makeTestTempDir('doubao-claim-');
  const s = bootServer({
    reposDir: root,
    attachmentsDir: root,
    skillsDir: root,
    homeDir: root,
    dataDir: root,
    workspacesDir: root,
    ...opts,
  });
  disposables.push(() => {
    s.dispose();
    releaseTestTempDir(root);
  });
  return s;
}

const machineDeps = (s: TestServer) => ({
  ...s.svc,
  box: s.secretBox,
  reposDir: s.reposDir,
  attachmentsDir: s.attachmentsDir,
  skillsDir: s.skillsDir,
});

function claim(s: TestServer, machineId: string) {
  return claimStep(machineDeps(s), machineId, s.team.id, 10, 'http://localhost');
}

async function createStartedTodo(
  s: TestServer,
  projectId: string,
  title: string,
  routeOverride?: { machineId?: string },
) {
  const createdTodo = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title,
    spec: '',
  });
  expect(createdTodo.status).toBe(201);
  const todoRow = (await createdTodo.json()) as { id: string };
  const startRes = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoRow.id],
    ...(routeOverride !== undefined ? { routeOverride } : {}),
  });
  expect(startRes.status).toBe(201);
  const buildRow = s.db.select().from(buildTable).where(eq(buildTable.todoId, todoRow.id)).get()!;
  const workerStep = s.db.select().from(stepTable).where(eq(stepTable.buildId, buildRow.id)).get()!;
  return { todoRow, buildRow, workerStep };
}

function queueOfStep(s: TestServer, row: typeof stepTable.$inferSelect) {
  const buildRow = s.db.select().from(buildTable).where(eq(buildTable.id, row.buildId)).get();
  const todoRow = buildRow
    ? s.db.select().from(todoTable).where(eq(todoTable.id, buildRow.todoId)).get()
    : undefined;
  const homeMachineId =
    todoRow === undefined
      ? null
      : (profileForStep(s.db, todoRow, row.kind, row.id)?.machineId ?? null);
  return stepQueueProjector(s.db, s.team.id).project({
    id: row.id,
    createdAt: row.createdAt,
    homeMachineId,
    holdReason: row.holdReason,
    holdUntil: row.holdUntil,
  });
}

describe('Doubao routing, multi-runner QR login, claim, and fallback', () => {
  test('routes Worker and Coordinator steps strictly to bound authenticated runner and blocks unauthenticated/offline runners with accurate queue reason', async () => {
    const s = bootFastServer({ githubFetch: async () => new Response('[]') });
    setCoordinatorInServer(false);

    const miniId = insertMachine(s, {
      name: 'mac-mini',
      capabilities: { mcpServers: [], skills: [], executor: 'host' },
    });
    const mbpId = insertMachine(s, {
      name: 'macbook-pro',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: true,
          authenticated: false,
          platformSupported: true,
          probedAt: 100,
        },
      },
    });
    s.db
      .update(teamTable)
      .set({ defaultMachineId: miniId })
      .where(eq(teamTable.id, s.team.id))
      .run();
    expect(doubaoUsable(s.db, s.team.id)).toBe(false);

    const sub = createDoubaoSubscription({ db: s.db }, s.team.id, {
      label: 'MBP 豆包',
      runnerId: mbpId,
    });
    seedRoute(s, 'session', { provider: 'doubao', modelId: '4' });
    seedRoute(s, 'coordinator', { provider: 'doubao', modelId: '4' });

    const projId = await postProject(s.app, 'doubao-worker-proj');
    const { workerStep } = await createStartedTodo(s, projId, 'Run on doubao');

    expect(await claim(s, miniId)).toBeNull();
    expect(await claim(s, mbpId)).toBeNull();
    expect(queueOfStep(s, workerStep)?.blocked).toEqual({
      kind: 'doubao-login-required',
      missing: ['macbook-pro'],
    });

    s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          doubao: {
            installed: true,
            authenticated: true,
            platformSupported: true,
            version: '2.38.4',
            probedAt: 200,
            models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
          },
        },
      })
      .where(eq(machineTable.id, mbpId))
      .run();
    expect(doubaoUsable(s.db, s.team.id)).toBe(true);
    expect(await claim(s, miniId)).toBeNull();
    const claimedWorker = await claim(s, mbpId);
    expect(claimedWorker?.step.id).toBe(workerStep.id);
    const workerRowAfter = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, workerStep.id))
      .get()!;
    expect(workerRowAfter.doubaoSubscriptionId).toBe(sub.id);
    expect(workerRowAfter.ranModel?.provider).toBe('doubao');

    s.db
      .update(stepTable)
      .set({ status: 'done', finishedAt: Date.now() })
      .where(eq(stepTable.id, workerStep.id))
      .run();

    s.db
      .insert(chiefTable)
      .values({ id: 'chief-1', userId: s.svc.user.id, teamId: s.team.id, createdAt: 100 })
      .run();
    s.db
      .insert(chiefThreadTable)
      .values({
        id: 'thread-1',
        chiefId: 'chief-1',
        userId: s.svc.user.id,
        teamId: s.team.id,
        title: 'Coordinator turn',
        createdAt: 100,
        updatedAt: 100,
        sessionId: '',
        sessionOpenedAt: 100,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 'chief-step-1',
        buildId: 'thread-1',
        kind: 'chief',
        status: 'pending',
        prompt: 'hi chief',
        createdAt: 100,
      })
      .run();
    expect(await claim(s, miniId)).toBeNull();
    const claimedChief = await claim(s, mbpId);
    expect(claimedChief?.step.id).toBe('chief-step-1');
    expect(
      s.db.select().from(stepTable).where(eq(stepTable.id, 'chief-step-1')).get()
        ?.doubaoSubscriptionId,
    ).toBe(sub.id);

    const directReject = claimPendingChiefStep(
      s.db,
      {
        ...s.db.select().from(stepTable).where(eq(stepTable.id, 'chief-step-1')).get()!,
        status: 'pending',
      },
      {
        machineId: miniId,
        bind: { runtime: 'doubao', teamId: s.team.id },
        model: { provider: 'doubao', modelId: '4', thinkingLevel: null },
      },
    );
    expect(directReject).toBeNull();
  });

  test('blocks unauthenticated runner with doubao-login-required, blocks old runner without doubao capability, claims after QR login without leaking to other runners, enforces per-runner model availability, isolates per-computer logins, preserves existing team defaults, and runs configured fallback', async () => {
    const s = bootFastServer({ githubFetch: async () => new Response('[]') });
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'owner', accessToken: 'token', scope: 'repo' },
    );

    const oldRunner = insertMachine(s, {
      name: 'old-runner',
      capabilities: { mcpServers: [], skills: [], executor: 'host' },
    });
    const runnerA = insertMachine(s, {
      name: 'runner-a',
      claudeCodeReport: {
        installed: true,
        hostname: 'runner-a',
        models: [{ id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' }],
      },
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: false,
          authenticated: false,
          platformSupported: true,
          probedAt: 100,
        },
      },
    });
    const runnerB = insertMachine(s, {
      name: 'runner-b',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: true,
          authenticated: false,
          platformSupported: true,
          probedAt: 100,
        },
      },
    });

    const claudeRes = await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions`, {
      label: 'Claude Primary',
      token: `sk-ant-oat01-${'a'.repeat(60)}`,
    });
    expect(claudeRes.status).toBe(201);
    const teamSub = createDoubaoSubscription({ db: s.db }, s.team.id, {
      label: 'Team 豆包',
    });
    expect(teamSub.runnerId).toBeNull();
    expect(claudeCodeUsable(s.db, s.team.id)).toBe(true);
    expect(defaultSessionChoice(s.db, s.team.id)?.provider).toBe('claude-code');

    upsertRoutingRule(s.db, s.team.id, 'session', {
      provider: 'doubao',
      modelId: '4',
      machineId: runnerA,
      fallbackModels: [{ provider: 'claude-code', modelId: 'claude-sonnet-5-5' }],
    });

    const ghProjId = await postProject(s.app, 'multi-runner-gh');
    s.db
      .update(projectTable)
      .set({ repoKind: 'github', githubRepo: 'acme/demo' })
      .where(eq(projectTable.id, ghProjId))
      .run();
    const { workerStep: s1 } = await createStartedTodo(s, ghProjId, 'Scan needed first');

    expect(await claim(s, oldRunner)).toBeNull();
    expect(await claim(s, runnerA)).toBeNull();
    expect(await claim(s, runnerB)).toBeNull();
    const qInitial = queueOfStep(s, s1);
    expect(qInitial?.waitingFor?.machineId).toBe(runnerA);
    expect(qInitial?.blocked).toEqual({ kind: 'doubao-login-required', missing: ['runner-a'] });

    const localProjId = await postProject(s.app, 'local-b');
    s.db
      .update(projectTable)
      .set({ repoKind: 'local', localPath: '/srv/b-repo' })
      .where(eq(projectTable.id, localProjId))
      .run();
    const { workerStep: sLocalB } = await createStartedTodo(s, localProjId, 'Local B', {
      machineId: runnerB,
    });

    s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          doubao: {
            installed: true,
            authenticated: true,
            platformSupported: true,
            probedAt: 200,
            models: [
              { id: '4', name: 'Doubao 2.1 Turbo' },
              { id: '5', name: 'Doubao 2.1 Pro' },
            ],
          },
        },
      })
      .where(eq(machineTable.id, runnerA))
      .run();

    expect(await claim(s, runnerB)).toBeNull();
    expect(queueOfStep(s, sLocalB)?.waitingFor?.machineId).toBe(runnerB);
    expect(queueOfStep(s, sLocalB)?.blocked).toEqual({
      kind: 'doubao-login-required',
      missing: ['runner-b'],
    });

    const claimedOnA = await claim(s, runnerA);
    expect(claimedOnA?.step.id).toBe(s1.id);

    s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          doubao: {
            installed: true,
            authenticated: true,
            platformSupported: true,
            probedAt: 300,
            models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
          },
        },
      })
      .where(eq(machineTable.id, runnerB))
      .run();
    const claimedLocalB = await claim(s, runnerB);
    expect(claimedLocalB?.step.id).toBe(sLocalB.id);

    upsertRoutingRule(s.db, s.team.id, 'session', {
      provider: 'doubao',
      modelId: '5',
      machineId: runnerB,
      fallbackModels: [{ provider: 'claude-code', modelId: 'claude-sonnet-5-5' }],
    });
    const { todoRow: sModel5Todo, workerStep: sModel5 } = await createStartedTodo(
      s,
      ghProjId,
      'Needs model 5',
      {
        machineId: runnerB,
      },
    );
    s.db
      .update(todoTable)
      .set({
        request: {
          segments: [
            {
              source: { kind: 'chat', threadId: 't-model5', messageId: 'm-model5', span: 'whole' },
              author: 'owner',
              sourceRef: null,
              text: 'Needs model 5',
            },
          ],
          siblings: [],
          difficulty: null,
          titleSource: 'owner',
          titleSourceRef: null,
          model: { provider: 'doubao', modelId: '5', thinkingLevel: null },
        },
      })
      .where(eq(todoTable.id, sModel5Todo.id))
      .run();
    expect(await claim(s, runnerB)).toBeNull();
    expect(queueOfStep(s, sModel5)?.blocked?.kind).toBe('model-unavailable');

    upsertRoutingRule(s.db, s.team.id, 'session', {
      provider: 'doubao',
      modelId: '4',
      machineId: runnerA,
      fallbackModels: [{ provider: 'claude-code', modelId: 'claude-sonnet-5-5' }],
    });

    await finishStep(machineDeps(s), runnerA, s1.id, {
      generation: claimedOnA!.step.generation,
      status: 'failed',
      errorMessage: 'authentication_failed',
    });
    const afterFallback = s.db.select().from(stepTable).where(eq(stepTable.id, s1.id)).get()!;
    expect(afterFallback.fallback?.model?.provider).toBe('claude-code');
    expect(afterFallback.status).toBe('pending');
    const claimedFallback = await claim(s, runnerA);
    expect(claimedFallback?.step.id).toBe(s1.id);
    expect(claimedFallback?.agent?.provider).toBe('claude-code');
  });

  test('keeps chosen computer pinned without silently hopping to another personal account, requires fresh session after account switch, and recovers on re-scan', async () => {
    const s = bootFastServer({ githubFetch: async () => new Response('[]') });
    const runnerPref = insertMachine(s, {
      name: 'mac-mini-pref',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: true,
          authenticated: false,
          platformSupported: true,
          probedAt: 100,
        },
      },
    });
    const runnerAlt = insertMachine(s, {
      name: 'mbp-other-account',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: true,
          authenticated: false,
          platformSupported: true,
          probedAt: 100,
        },
      },
    });
    s.db
      .update(teamTable)
      .set({ defaultMachineId: runnerPref })
      .where(eq(teamTable.id, s.team.id))
      .run();
    createDoubaoSubscription({ db: s.db }, s.team.id, { label: 'Team Doubao' });
    seedRoute(s, 'session', { provider: 'doubao', modelId: '4' });

    const projId = await postProject(s.app, 'identity-pin-proj');
    const { todoRow, workerStep } = await createStartedTodo(s, projId, 'Prefer mac-mini');

    expect(await claim(s, runnerPref)).toBeNull();
    expect(await claim(s, runnerAlt)).toBeNull();
    const waitPref = queueOfStep(s, workerStep);
    expect(waitPref?.waitingFor?.machineId).toBe(runnerPref);
    expect(waitPref?.blocked).toEqual({
      kind: 'doubao-login-required',
      missing: ['mac-mini-pref'],
    });

    s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          doubao: {
            installed: true,
            authenticated: true,
            platformSupported: true,
            probedAt: 200,
            models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
          },
        },
      })
      .where(eq(machineTable.id, runnerAlt))
      .run();
    s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          doubao: {
            installed: true,
            authenticated: true,
            platformSupported: true,
            probedAt: 200,
            models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
          },
        },
      })
      .where(eq(machineTable.id, runnerPref))
      .run();
    const claimedFirst = await claim(s, runnerPref);
    expect(claimedFirst?.step.id).toBe(workerStep.id);

    await finishStep(machineDeps(s), runnerPref, workerStep.id, {
      generation: claimedFirst!.step.generation,
      status: 'success',
      sessionId: 'sess-account-a',
    });
    s.db
      .delete(stepTable)
      .where(and(eq(stepTable.buildId, workerStep.buildId), eq(stepTable.status, 'pending')))
      .run();

    const followStepId = 'follow-step-switch';
    s.db
      .update(buildTable)
      .set({ prevPhase: 'done' })
      .where(eq(buildTable.id, workerStep.buildId))
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: followStepId,
        buildId: workerStep.buildId,
        kind: 'session',
        status: 'pending',
        prompt: 'continue build',
        createdAt: Date.now(),
      })
      .run();
    const followStep = { id: followStepId };
    void todoRow;

    s.db.update(teamTable).set({ defaultMachineId: null }).where(eq(teamTable.id, s.team.id)).run();
    const expiredAt = Date.now() - 60_000;
    s.db
      .update(machineTable)
      .set({ online: false, lastSeenAt: expiredAt })
      .where(eq(machineTable.id, runnerPref))
      .run();
    s.db
      .update(stepTable)
      .set({ createdAt: expiredAt })
      .where(eq(stepTable.id, followStep.id))
      .run();
    expect(await claim(s, runnerAlt)).toBeNull();
    const offlineQueue = queueOfStep(
      s,
      s.db.select().from(stepTable).where(eq(stepTable.id, followStep.id)).get()!,
    );
    expect(offlineQueue?.waitingFor?.machineId).toBe(runnerPref);
    expect(offlineQueue?.blocked?.kind).toBe('machine-offline');
    expect(offlineQueue?.alternateMachines?.some((m) => m.machineId === runnerAlt)).toBe(true);

    s.db
      .update(teamTable)
      .set({ defaultMachineId: runnerPref })
      .where(eq(teamTable.id, s.team.id))
      .run();
    s.db
      .update(machineTable)
      .set({
        online: true,
        capabilities: {
          mcpServers: [],
          skills: [],
          doubao: { installed: true, authenticated: false, platformSupported: true, probedAt: 300 },
        },
      })
      .where(eq(machineTable.id, runnerPref))
      .run();
    const { workerStep: genericAuthedStep } = await createStartedTodo(
      s,
      projId,
      'Generic goes to scanned runnerAlt',
    );
    expect(queueOfStep(s, genericAuthedStep)?.waitingFor?.machineId).toBe(runnerAlt);
    const claimedGeneric = await claim(s, runnerAlt);
    expect(claimedGeneric?.step.id).toBe(genericAuthedStep.id);
    await finishStep(machineDeps(s), runnerAlt, genericAuthedStep.id, {
      generation: claimedGeneric!.step.generation,
      status: 'success',
    });
    s.db
      .delete(stepTable)
      .where(and(eq(stepTable.buildId, genericAuthedStep.buildId), eq(stepTable.status, 'pending')))
      .run();

    const switchAt = Date.now() + 5_000;
    s.db
      .update(machineTable)
      .set({
        online: true,
        capabilities: {
          mcpServers: [],
          skills: [],
          doubao: {
            installed: true,
            authenticated: true,
            platformSupported: true,
            probedAt: switchAt,
            switchedAt: switchAt,
            models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
          },
        },
      })
      .where(eq(machineTable.id, runnerPref))
      .run();
    const claimedFresh = await claim(s, runnerPref);
    expect(claimedFresh?.step.id).toBe(followStep.id);
    expect(claimedFresh?.session.action).toBe('new');
    expect(claimedFresh?.session.sessionId).toBeNull();

    s.db
      .insert(chiefTable)
      .values({ id: 'chief-sw', userId: s.svc.user.id, teamId: s.team.id, createdAt: 100 })
      .run();
    s.db
      .insert(chiefThreadTable)
      .values({
        id: 'thread-sw',
        chiefId: 'chief-sw',
        userId: s.svc.user.id,
        teamId: s.team.id,
        title: 'Switch Chief',
        createdAt: 100,
        updatedAt: 100,
        sessionId: 'chief-old-sess',
        sessionRuntime: 'doubao',
        sessionOpenedAt: 100,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 'chief-prev-done',
        buildId: 'thread-sw',
        kind: 'chief',
        status: 'done',
        sessionId: 'chief-old-sess',
        prompt: 'old turn',
        createdAt: switchAt - 10_000,
        claimedAt: switchAt - 10_000,
        finishedAt: switchAt - 9_000,
      })
      .run();
    s.db.delete(stepTable).where(eq(stepTable.status, 'pending')).run();
    s.db
      .insert(stepTable)
      .values({
        id: 'chief-after-switch',
        buildId: 'thread-sw',
        kind: 'chief',
        status: 'pending',
        prompt: 'new turn after switch',
        createdAt: switchAt + 100,
      })
      .run();
    seedRoute(s, 'coordinator', { provider: 'doubao', modelId: '4' });
    const legacyDefault = insertMachine(s, {
      name: 'legacy-default',
      capabilities: { mcpServers: [], skills: [] },
    });
    s.db
      .update(teamTable)
      .set({ defaultMachineId: legacyDefault })
      .where(eq(teamTable.id, s.team.id))
      .run();
    s.db.update(machineTable).set({ online: false }).where(eq(machineTable.id, runnerAlt)).run();
    expect(await claim(s, legacyDefault)).toBeNull();
    const claimedChiefAfterSwitch = await claim(s, runnerPref);
    expect(claimedChiefAfterSwitch?.step.id).toBe('chief-after-switch');
    expect(claimedChiefAfterSwitch?.session.action).toBe('new');
    expect(claimedChiefAfterSwitch?.session.sessionId).toBeNull();

    await finishStep(machineDeps(s), runnerPref, 'chief-after-switch', {
      generation: claimedChiefAfterSwitch!.step.generation,
      status: 'success',
    });
    const nowRace = Date.now();
    s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          doubao: {
            installed: true,
            authenticated: true,
            platformSupported: true,
            probedAt: nowRace - 20_000,
            switchedAt: nowRace - 20_000,
            models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
          },
        },
      })
      .where(eq(machineTable.id, runnerPref))
      .run();
    const { buildRow: raceBuild, workerStep: raceStep1 } = await createStartedTodo(
      s,
      projId,
      'Race Build',
    );
    const claimedRace1 = await claim(s, runnerPref);
    expect(claimedRace1?.step.id).toBe(raceStep1.id);
    await finishStep(machineDeps(s), runnerPref, raceStep1.id, {
      generation: claimedRace1!.step.generation,
      status: 'success',
      sessionId: 'sess-before-race',
    });
    s.db.delete(stepTable).where(eq(stepTable.status, 'pending')).run();
    const raceStep2Id = 'worker-race-2';
    s.db
      .insert(stepTable)
      .values({
        id: raceStep2Id,
        buildId: raceBuild.id,
        kind: 'session',
        status: 'pending',
        prompt: 'worker race step',
        createdAt: Date.now() + 1,
      })
      .run();
    const raceStep2Row = s.db.select().from(stepTable).where(eq(stepTable.id, raceStep2Id)).get()!;
    const priorCheck = priorSessionOf(
      s.db,
      raceStep2Row,
      raceBuild,
      {
        claude: null,
        devin: null,
        antigravity: null,
        doubao: s.db.select().from(stepTable).where(eq(stepTable.id, raceStep1.id)).get()!
          .doubaoSubscriptionId,
      },
      'doubao',
    );
    expect(priorCheck).toMatchObject({ priorSessionId: 'sess-before-race', freshSession: false });
    let txAttempts = 0;
    const originalTx = s.db.transaction.bind(s.db);
    vi.spyOn(s.db, 'transaction').mockImplementation(((
      cb: Parameters<typeof s.db.transaction>[0],
      opts?: Parameters<typeof s.db.transaction>[1],
    ) => {
      if (opts?.behavior === 'immediate') {
        txAttempts += 1;
        if (txAttempts === 1) {
          s.db
            .update(machineTable)
            .set({
              capabilities: {
                mcpServers: [],
                skills: [],
                doubao: {
                  installed: true,
                  authenticated: true,
                  platformSupported: true,
                  probedAt: nowRace + 50_000,
                  switchedAt: nowRace + 50_000,
                  models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
                },
              },
            })
            .where(eq(machineTable.id, runnerPref))
            .run();
        }
      }
      return originalTx(cb, opts);
    }) as typeof s.db.transaction);
    const claimedAfterRace = await claim(s, runnerPref);
    expect(txAttempts).toBe(2);
    expect(claimedAfterRace?.step.id).toBe(raceStep2Id);
    expect(claimedAfterRace?.session.action).toBe('new');
    expect(claimedAfterRace?.session.sessionId).toBeNull();
  });

  test('records inTurnIndex null when active Worker or Coordinator Doubao turn repeats a saved correction', async () => {
    const s = bootFastServer({ githubFetch: async () => new Response('[]') });
    const mbpId = insertMachine(s, {
      name: 'macbook-pro-mem',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: true,
          authenticated: true,
          platformSupported: true,
          version: '2.38.4',
          probedAt: 100,
          models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
        },
      },
    });
    const sub = createDoubaoSubscription({ db: s.db }, s.team.id, {
      label: 'MBP 豆包',
      runnerId: mbpId,
    });
    seedRoute(s, 'session', { provider: 'doubao', modelId: '4' });
    const rule = '- Reply with the conclusion first.';
    const owner = { agentId: 'agent-chief-1', teamId: s.team.id, projectId: null };
    const initialDoc = executeMemoryDocumentTool(s.db, owner, 'memories', {
      scope: 'team',
      file: 'MEMORY.md',
    }) as { baseVersion: string };
    const seededDoc = executeMemoryDocumentTool(s.db, owner, 'update_memory', {
      scope: 'team',
      file: 'MEMORY.md',
      baseVersion: initialDoc.baseVersion,
      content: rule,
    }) as { baseVersion: string };

    const { indexes } = injectMemoryDocuments(s.db, { ...owner, teamScoped: true });
    const memoryTrace = {
      teamMemoryIds: indexes.map((entry) => entry.id),
      teamMemoriesOmitted: 0,
      projectMemoryIds: [],
      projectMemoriesOmitted: 0,
      recalledMemoryIds: [],
    };
    const now = Date.now() + 50;

    const projId = await postProject(s.app, 'doubao-mem-proj');
    const { buildRow, workerStep } = await createStartedTodo(s, projId, 'Doubao memory worker');
    s.db
      .insert(messageTable)
      .values({
        id: 'mem-user-worker',
        conversationId: buildRow.id,
        role: 'user',
        content: 'Conclusion first again.',
        createdAt: now,
        origin: 'user',
      })
      .run();
    s.db
      .update(stepTable)
      .set({
        status: 'claimed',
        claimedAt: now + 5,
        doubaoSubscriptionId: sub.id,
        sessionId: 'db-worker-mem-sess',
        memoryTrace,
      })
      .where(eq(stepTable.id, workerStep.id))
      .run();

    executeMemoryToolForStep(s.db, owner, workerStep.id, 'update_memory', {
      scope: 'team',
      file: 'MEMORY.md',
      baseVersion: seededDoc.baseVersion,
      correction: true,
      repeats: rule,
    });

    s.db
      .insert(chiefTable)
      .values({ id: 'chief-mem', userId: s.svc.user.id, teamId: s.team.id, createdAt: now })
      .run();
    s.db
      .insert(chiefThreadTable)
      .values({
        id: 'thread-mem',
        chiefId: 'chief-mem',
        userId: s.svc.user.id,
        teamId: s.team.id,
        title: 'Doubao Memory Chief',
        createdAt: now,
        updatedAt: now,
        sessionId: 'db-chief-mem-sess',
        sessionOpenedAt: now,
      })
      .run();
    s.db
      .insert(chiefMessageTable)
      .values({
        id: 'chief-mem-user',
        threadId: 'thread-mem',
        role: 'user',
        content: 'Always answer concisely.',
        projectId: null,
        createdAt: now + 10,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 'chief-mem-step',
        buildId: 'thread-mem',
        kind: 'chief',
        status: 'claimed',
        claimedAt: now + 20,
        createdAt: now + 15,
        prompt: 'Always answer concisely.',
        ownerMessageIds: ['chief-mem-user'],
        doubaoSubscriptionId: sub.id,
        sessionId: 'db-chief-mem-sess',
        memoryTrace,
      })
      .run();

    const latestDoc = executeMemoryDocumentTool(s.db, owner, 'memories', {
      scope: 'team',
      file: 'MEMORY.md',
    }) as { baseVersion: string };
    executeMemoryToolForStep(s.db, owner, 'chief-mem-step', 'update_memory', {
      scope: 'team',
      file: 'MEMORY.md',
      baseVersion: latestDoc.baseVersion,
      correction: true,
      repeats: rule,
    });

    const recorded = s.db.select().from(memoryCorrectionTable).all();
    expect(recorded).toHaveLength(2);
    expect(recorded).toMatchObject([
      { stepId: workerStep.id, pointedRule: rule, inTurnIndex: null },
      { stepId: 'chief-mem-step', pointedRule: rule, inTurnIndex: null },
    ]);
  });
});
