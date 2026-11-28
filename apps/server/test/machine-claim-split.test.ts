import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASK_USER_QUESTION_KIND,
  CLAIM_PAYLOAD_VERSION,
  type ClaimedStep,
  type ClaudeCodeReport,
  claimedStepSchema,
  machineTokenResponseSchema,
} from '@cairn/shared';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { startCoordinator } from '../src/coordinator/index.js';
import {
  chiefMessage,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  mcpConnector,
  project as projectTable,
  routingRule,
  step as stepTable,
} from '../src/db/schema.js';
import { HttpError, NotFoundError } from '../src/lib/errors.js';
import { newRecordId } from '../src/lib/ids.js';
import {
  BUILD_ABANDONED_STEP_MS,
  sweepAbandonedBuildSteps,
} from '../src/services/build-abandoned-sweep.js';
import {
  CHIEF_ABANDONED_STEP_MS,
  openProjectChannel,
  sweepAbandonedChiefSteps,
} from '../src/services/chief.js';
import { askQuestionContentOf } from '../src/services/chief-question-store.js';
import { setCoordinatorInServer, setCoordinatorWake } from '../src/services/coordinator-context.js';
import { setCoordinatorSignal } from '../src/services/coordinator-signal.js';
import { ABANDONED_CLAIM_QUARANTINE_LIMIT } from '../src/services/dispatch-timeouts.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import * as machineClaim from '../src/services/machine-claim.js';
import * as machineClaimPayload from '../src/services/machine-claim-payload.js';
import type { MachineDeps } from '../src/services/machine-deps.js';
import * as machines from '../src/services/machines.js';
import { createProvider } from '../src/services/providers.js';
import { readMemoryTrace, writeMemoryTrace } from '../src/services/step-groups/memory-trace.js';
import * as stepLease from '../src/services/step-lease.js';
import {
  bootServer,
  insertClaudeSubscription,
  insertMachine,
  issueApiKey,
  seedRoute,
  seedSessionRoute,
  startLegacyBuild,
  type TestServer,
} from './helpers.js';

const FROZEN_PRE_V1_STEP_SCHEMA = z.object({
  step: z.object({
    id: z.string(),
    buildId: z.string(),
    kind: z.enum(['plan', 'build', 'session', 'merge', 'review', 'verify', 'chief']),
    machineId: z.string().nullable(),
    createdAt: z.number(),
    generation: z.number().optional(),
  }),
  conversationId: z.string(),
  session: z.object({
    action: z.enum(['new', 'continue']),
    sessionId: z.string().nullable(),
    priorMachineId: z.string().optional(),
  }),
  instruction: z.string().nullable().optional(),
  answerIds: z.array(z.string().min(1)).optional(),
  agent: z
    .object({
      id: z.string(),
      displayName: z.string(),
      description: z.string().nullable(),
      provider: z.string().nullable(),
      modelId: z.string().nullable(),
      thinkingLevel: z.string().nullable(),
      memories: z.array(z.object({ title: z.string(), content: z.string() })).optional(),
    })
    .nullable(),
  chief: z
    .object({
      threadId: z.string(),
      systemPrompt: z.string(),
      trigger: z.enum(['user', 'gate', 'settle', 'failed', 'wake']),
      history: z.string().optional(),
    })
    .optional(),
  remoteTools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
      }),
    )
    .optional(),
  localTools: z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
});

const disposables: (() => Promise<void> | void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  setCoordinatorInServer(false);
  setCoordinatorWake(() => {});
  setCoordinatorSignal(() => {});
});
afterAll(async () => {
  for (const d of disposables.splice(0)) await d();
});

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'x-cairn-raw-send': '1' };
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return app.request(path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
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

function insertConnector(s: TestServer, slug: string) {
  s.db
    .insert(mcpConnector)
    .values({
      id: newRecordId(),
      teamId: s.team.id,
      slug,
      label: slug,
      catalogId: null,
      url: `https://${slug}.example/mcp`,
      headerNames: ['Authorization'],
      valuesCipher: s.secretBox.seal(JSON.stringify({ Authorization: `Bearer tok-${slug}` })),
      authKind: 'static',
      oauthMeta: null,
      oauthCipher: null,
      status: 'connected',
      statusReason: null,
      toolCount: 1,
      toolsJson: [],
      checkedAt: 1,
      authRevision: 1,
      tokenGeneration: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
}

function pendingQuestionContent(requestId: string): string {
  return JSON.stringify({
    kind: ASK_USER_QUESTION_KIND,
    requestId,
    status: 'pending',
    questions: [
      {
        header: 'Confirm',
        question: 'Proceed with release?',
        options: [{ label: 'Yes', description: 'Continue' }],
        multiSelect: false,
      },
    ],
    answers: null,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function setupWorkerWorld(
  opts: {
    cliVersion?: string;
    githubFetch?: NonNullable<Parameters<typeof bootServer>[0]>['githubFetch'];
    repoKind?: 'hosted' | 'github';
    githubRepo?: string;
    mcpServers?: string[];
    mcpConnectors?: boolean;
  } = {},
) {
  const s = bootServer({
    claimHoldMs: 50,
    ...(opts.githubFetch !== undefined ? { githubFetch: opts.githubFetch } : {}),
  });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enrolled = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({
      teamId: s.team.id,
      name: 'split-worker',
      cliVersion: opts.cliVersion ?? '0.2.5',
      capabilities: {
        mcpServers: opts.mcpServers ?? ['alpha'],
        ...(opts.mcpConnectors ? { mcpConnectors: true } : {}),
        skills: [],
        claimGeneration: true,
        runnerProtocolVersion: 1,
      },
    }),
  });
  const { token, machineId } = (await enrolled.json()) as { token: string; machineId: string };
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model', machineId });
  let projectId: string;
  if (opts.repoKind === 'github' && opts.githubRepo !== undefined) {
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: 'ghp_worker_claim', scope: 'repo' },
    );
    projectId = newRecordId();
    s.db
      .insert(projectTable)
      .values({
        id: projectId,
        teamId: s.team.id,
        name: 'split-proj',
        repoKind: 'github',
        githubRepo: opts.githubRepo,
      })
      .run();
  } else {
    const projectRes = await call(s.app, 'POST', '/api/projects', {
      body: { name: 'split-proj', repoKind: 'hosted' },
    });
    expect(projectRes.status).toBe(201);
    projectId = ((await projectRes.json()) as { id: string }).id;
  }
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'split task', spec: 'verify claim split' },
  });
  expect(todoRes.status).toBe(201);
  const todo = (await todoRes.json()) as { id: string };
  const buildId = startLegacyBuild(s, todo.id, { withPlan: false });
  const stepRow = () => s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get()!;
  return { s, token, machineId, projectId, todoId: todo.id, buildId, stepRow };
}

async function setupDaemonChiefWorld(
  opts: {
    githubFetch?: NonNullable<Parameters<typeof bootServer>[0]>['githubFetch'];
    githubProject?: string;
  } = {},
) {
  const s = bootServer({
    claimHoldMs: 50,
    ...(opts.githubFetch !== undefined ? { githubFetch: opts.githubFetch } : {}),
  });
  disposables.push(() => s.dispose());
  insertClaudeSubscription(s);
  const key = await issueApiKey(s);
  const report: ClaudeCodeReport = {
    installed: true,
    hostname: 'split-chief',
    models: [{ id: 'sonnet', name: 'sonnet' }],
    auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
  };
  const enrolled = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({
      teamId: s.team.id,
      name: 'split-chief',
      cliVersion: '0.2.5',
      claudeCode: report,
      capabilities: {
        mcpServers: ['alpha'],
        mcpConnectors: true,
        skills: [],
        claimGeneration: true,
        runnerProtocolVersion: 1,
      },
    }),
  });
  const { token, machineId } = (await enrolled.json()) as { token: string; machineId: string };
  seedRoute(s, 'coordinator', {
    provider: 'claude-code',
    modelId: 'sonnet',
    thinkingLevel: 'off',
    machineId,
  });
  let threadId: string;
  if (opts.githubProject !== undefined) {
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: 'ghp_chief_claim', scope: 'repo' },
    );
    const projectId = newRecordId();
    s.db
      .insert(projectTable)
      .values({
        id: projectId,
        teamId: s.team.id,
        name: 'chief-gh-proj',
        repoKind: 'github',
        githubRepo: opts.githubProject,
      })
      .run();
    threadId = openProjectChannel(s.svc, s.team.id, projectId).thread.id;
  } else {
    const threadRes = await call(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
      body: { content: 'hello chief', clientMessageId: 'msg-chief-split-1' },
    });
    expect(threadRes.status).toBe(201);
    threadId = ((await threadRes.json()) as { thread: { id: string } }).thread.id;
  }
  const stepRow = () => s.db.select().from(stepTable).where(eq(stepTable.buildId, threadId)).get()!;
  return { s, token, machineId, threadId, stepRow };
}

describe('machine-claim split: protocol, lease kernel, and payload builder', () => {
  test('HTTP claim emits payloadVersion = 1 for worker steps and a standalone frozen pre-v1 runner schema finishes the step', async () => {
    const w = await setupWorkerWorld();
    const claimRes = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
      cred: w.token,
      body: { verifyAttachments: true },
    });
    expect(claimRes.status).toBe(200);
    const raw = (await claimRes.json()) as { step: Record<string, unknown> | null };
    expect(raw.step).not.toBeNull();
    expect(raw.step?.payloadVersion).toBe(CLAIM_PAYLOAD_VERSION);

    const parsedV1 = claimedStepSchema.parse(raw.step);
    expect(parsedV1.payloadVersion).toBe(1);

    const legacyParsed = FROZEN_PRE_V1_STEP_SCHEMA.parse(raw.step);
    expect('payloadVersion' in legacyParsed).toBe(false);

    const gen = legacyParsed.step.generation!;
    const hb = await call(
      w.s.app,
      'POST',
      `/api/machine/heartbeat/${legacyParsed.step.id}?generation=${gen}`,
      { cred: w.token, body: {} },
    );
    expect(hb.status).toBe(200);

    const tok = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${legacyParsed.step.id}?generation=${gen}`,
      { cred: w.token },
    );
    expect(tok.status).toBe(200);

    const done = await call(w.s.app, 'POST', `/api/machine/done/${legacyParsed.step.id}`, {
      cred: w.token,
      body: { status: 'failed', errorMessage: 'done via frozen pre-v1 client', generation: gen },
    });
    expect(done.status).toBe(200);
    expect(w.stepRow().status).toBe('failed');
  });

  test('HTTP claim emits payloadVersion = 1 for daemon-claimed chief turns and completes heartbeat, token, and done with frozen pre-v1 parser', async () => {
    const w = await setupDaemonChiefWorld();
    const claimRes = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
      cred: w.token,
      body: {},
    });
    expect(claimRes.status).toBe(200);
    const raw = (await claimRes.json()) as { step: Record<string, unknown> | null };
    expect(raw.step).not.toBeNull();
    expect(raw.step?.payloadVersion).toBe(1);
    const parsedV1 = claimedStepSchema.parse(raw.step);
    expect(parsedV1.step.kind).toBe('chief');
    expect(parsedV1.payloadVersion).toBe(1);

    const legacyParsed = FROZEN_PRE_V1_STEP_SCHEMA.parse(raw.step);
    expect('payloadVersion' in legacyParsed).toBe(false);
    const gen = legacyParsed.step.generation!;

    const hb = await call(
      w.s.app,
      'POST',
      `/api/machine/heartbeat/${legacyParsed.step.id}?generation=${gen}`,
      { cred: w.token, body: {} },
    );
    expect(hb.status).toBe(200);

    const tok = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${legacyParsed.step.id}?generation=${gen}`,
      { cred: w.token },
    );
    expect(tok.status).toBe(200);

    const done = await call(w.s.app, 'POST', `/api/machine/done/${legacyParsed.step.id}`, {
      cred: w.token,
      body: { status: 'failed', errorMessage: 'chief turn finished', generation: gen },
    });
    expect(done.status).toBe(200);
    expect(w.stepRow().status).toBe('failed');
  });

  test('worker HTTP claim recomputes MCP grant inside the commit transaction and keeps claim payload, step row, and token in lockstep', async () => {
    const repoGateEntered = deferred<void>();
    const repoGateRelease = deferred<Response>();

    const w = await setupWorkerWorld({
      repoKind: 'github',
      githubRepo: 'octo/worker-mcp',
      mcpServers: ['alpha'],
      mcpConnectors: true,
      githubFetch: async (url) => {
        if (String(url).includes('/repos/octo/worker-mcp')) {
          repoGateEntered.resolve();
          return repoGateRelease.promise;
        }
        return new Response('Not found', { status: 404 });
      },
    });
    insertConnector(w.s, 'linear');

    const claimPromise = call(w.s.app, 'POST', '/api/machine/tasks/claim', {
      cred: w.token,
      body: { verifyAttachments: true },
    });
    await repoGateEntered.promise;

    w.s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: ['alpha', 'beta'],
          mcpConnectors: true,
          skills: [],
          claimGeneration: true,
          runnerProtocolVersion: 1,
        },
      })
      .where(eq(machineTable.id, w.machineId))
      .run();
    insertConnector(w.s, 'notion');

    repoGateRelease.resolve(
      new Response(JSON.stringify({ id: 9001, name: 'worker-mcp', owner: { login: 'octo' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const claimRes = await claimPromise;
    expect(claimRes.status).toBe(200);
    const raw = (await claimRes.json()) as { step: ClaimedStep | null };
    expect(raw.step?.payloadVersion).toBe(1);

    w.s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: ['alpha', 'beta', 'gamma'],
          mcpConnectors: true,
          skills: [],
          claimGeneration: true,
          runnerProtocolVersion: 1,
        },
      })
      .where(eq(machineTable.id, w.machineId))
      .run();
    insertConnector(w.s, 'slack');

    expect(raw.step?.mcpServers).toEqual(['alpha', 'beta', 'linear', 'notion']);
    expect(w.stepRow().mcpGrant).toEqual(['alpha', 'beta', 'linear', 'notion']);

    const gen = raw.step!.step.generation!;
    const tokRes = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${raw.step!.step.id}?generation=${gen}`,
      {
        cred: w.token,
      },
    );
    expect(tokRes.status).toBe(200);
    const tokenBody = machineTokenResponseSchema.parse(await tokRes.json());
    expect(tokenBody.mcpConnectors?.map((c) => c.slug)).toEqual(['linear', 'notion']);
  });

  test('daemon chief claim freezes commit-time MCP connectors after README wait and guards memoryTrace by claimedAt', async () => {
    const readmeEntered = deferred<void>();
    const readmeRelease = deferred<Response>();

    const w = await setupDaemonChiefWorld({
      githubProject: 'octo/chief-readme',
      githubFetch: async (url) => {
        if (String(url).includes('/repos/octo/chief-readme')) {
          readmeEntered.resolve();
          return readmeRelease.promise;
        }
        return new Response('Not found', { status: 404 });
      },
    });
    insertConnector(w.s, 'linear');

    const claimPromise = call(w.s.app, 'POST', '/api/machine/tasks/claim', {
      cred: w.token,
      body: {},
    });
    await readmeEntered.promise;
    insertConnector(w.s, 'notion');
    readmeRelease.resolve(new Response('Not found', { status: 404 }));

    const claimRes = await claimPromise;
    expect(claimRes.status).toBe(200);
    const claimed = ((await claimRes.json()) as { step: ClaimedStep | null }).step!;
    expect(claimed.payloadVersion).toBe(1);
    expect(claimed.mcpServers).toEqual(['alpha', 'linear', 'notion']);
    expect(w.stepRow().mcpGrant).toEqual(['alpha', 'linear', 'notion']);

    insertConnector(w.s, 'slack');
    const tokRes = await call(
      w.s.app,
      'GET',
      `/api/machine/token/${claimed.step.id}?generation=${claimed.step.generation}`,
      { cred: w.token },
    );
    expect(tokRes.status).toBe(200);
    const tokBody = machineTokenResponseSchema.parse(await tokRes.json());
    expect(tokBody.mcpConnectors?.map((c) => c.slug)).toEqual(['linear', 'notion']);

    const sentinelTrace = {
      teamMemoryIds: ['sentinel-team'],
      teamMemoriesOmitted: 0,
      projectMemoryIds: [],
      projectMemoriesOmitted: 0,
      recalledMemoryIds: [],
    };
    const newerClaimedAt = w.stepRow().claimedAt! + 500;
    w.s.db
      .update(stepTable)
      .set({ claimedAt: newerClaimedAt })
      .where(eq(stepTable.id, claimed.step.id))
      .run();
    w.s.db.transaction((tx) =>
      writeMemoryTrace(tx, claimed.step.id, { memoryTrace: sentinelTrace }),
    );

    const threadRow = w.s.db
      .select()
      .from(chiefThreadTable)
      .where(eq(chiefThreadTable.id, w.threadId))
      .get()!;
    const agentRow = w.s.svc.db
      .select()
      .from(routingRule)
      .where(eq(routingRule.use, 'coordinator'))
      .get()!;
    machineClaimPayload.buildChiefClaimPayload(machineDepsOf(w.s), {
      machineId: w.machineId,
      stepRow: { ...w.stepRow(), claimedAt: null },
      threadRow,
      agentRow: {
        id: agentRow.id,
        teamId: w.s.team.id,
        displayName: 'Coordinator',
        description: null,
        provider: agentRow.provider,
        modelId: agentRow.modelId,
        thinkingLevel: agentRow.thinkingLevel,
        fallbackModels: null,
        machineId: agentRow.machineId,
        requiredCapabilities: null,
        tools: [],
        skillsAllowlist: null,
        defaultSkill: null,
        secrets: [],
        routed: true,
      },
      readmeSection: null,
      stagedUploads: null,
      mcpServers: ['alpha', 'linear', 'notion'],
      hasMcpServers: true,
    });
    expect(readMemoryTrace(w.s.db, claimed.step.id).memoryTrace).toEqual(sentinelTrace);
  });

  test('in-server Coordinator fences memoryTrace write by claimed status, machineId = null, and claimedAt after awaiting README', async () => {
    setCoordinatorInServer(true);
    const readmeEntered = deferred<void>();
    const readmeRelease = deferred<Response>();

    const s = bootServer({
      githubFetch: async (url) => {
        if (String(url).includes('/repos/octo/inserver-coord')) {
          readmeEntered.resolve();
          return readmeRelease.promise;
        }
        return new Response('Not found', { status: 404 });
      },
    });
    insertMachine(s);
    disposables.push(() => s.dispose());
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: 'ghp_inserver_coord', scope: 'repo' },
    );
    createProvider(
      { db: s.db, box: s.secretBox },
      {
        teamId: s.team.id,
        body: {
          providerId: 'stub',
          label: 'Stub',
          baseUrl: 'http://127.0.0.1:9',
          api: 'openai-completions',
          apiKey: 'stub-key',
          models: [{ id: 'm', name: 'm' }],
        },
        createdBy: s.user.id,
      },
    );
    s.db
      .insert(routingRule)
      .values({
        id: 'rule-coord-inserver-race',
        teamId: s.team.id,
        use: 'coordinator',
        provider: 'stub',
        modelId: 'm',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();

    const coordProjectId = newRecordId();
    s.db
      .insert(projectTable)
      .values({
        id: coordProjectId,
        teamId: s.team.id,
        name: 'inserver-coord-proj',
        repoKind: 'github',
        githubRepo: 'octo/inserver-coord',
      })
      .run();
    const { thread } = openProjectChannel(s.svc, s.team.id, coordProjectId);

    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 200_000 }],
      tokensPerSecond: 1e9,
    });
    faux.setResponses([fauxAssistantMessage('hello')]);
    const coordinator = startCoordinator({
      machine: machineDepsOf(s),
      storageDir: s.reposDir,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      heartbeatMs: 1_000,
      tickMs: 3_600_000,
      stopPollMs: 50,
      fixedProviders: [
        {
          ...faux.provider,
          streamSimple(model, context, options) {
            return faux.provider.streamSimple(model, context, options);
          },
        },
      ],
    });
    setCoordinatorWake((threadId) => coordinator.wake(threadId));
    setCoordinatorSignal((threadId, kind) =>
      kind === 'steer' ? coordinator.signalSteer(threadId) : coordinator.signalStop(threadId),
    );
    disposables.push(() => coordinator.close());

    coordinator.wake(thread.id);
    await readmeEntered.promise;

    const current = s.db.select().from(stepTable).where(eq(stepTable.buildId, thread.id)).get()!;
    const sentinelTrace = {
      teamMemoryIds: ['reclaimed-team'],
      teamMemoriesOmitted: 0,
      projectMemoryIds: [],
      projectMemoriesOmitted: 0,
      recalledMemoryIds: [],
    };
    s.db
      .update(stepTable)
      .set({
        status: 'stopped',
        claimedAt: (current.claimedAt ?? 1) + 500,
      })
      .where(eq(stepTable.id, current.id))
      .run();
    s.db.transaction((tx) => writeMemoryTrace(tx, current.id, { memoryTrace: sentinelTrace }));

    readmeRelease.resolve(new Response('Not found', { status: 404 }));
    await coordinator.idle();

    expect(readMemoryTrace(s.db, current.id).memoryTrace).toEqual(sentinelTrace);
  });

  test('heartbeatStep advances lastHeartbeatAt, throws 410 on deleted step, and throws NotFoundError on unowned/pending step', async () => {
    const w = await setupWorkerWorld();
    const deps = machineDepsOf(w.s);
    const claimed = await machineClaim.claimStep(
      deps,
      w.machineId,
      w.s.team.id,
      0,
      'http://localhost',
    );
    expect(claimed).not.toBeNull();
    const stepId = claimed!.step.id;

    const initialBeat = w.stepRow().lastHeartbeatAt!;
    w.s.db
      .update(stepTable)
      .set({ lastHeartbeatAt: initialBeat - 5000 })
      .where(eq(stepTable.id, stepId))
      .run();

    stepLease.heartbeatStep(deps, w.machineId, stepId);
    expect(w.stepRow().lastHeartbeatAt!).toBeGreaterThan(initialBeat - 5000);

    expect(() => stepLease.heartbeatStep(deps, 'other-machine', stepId)).toThrow(NotFoundError);

    expect(
      stepLease.releaseStepLease(w.s.db, stepId, {
        expectedMachineId: w.machineId,
        expectedClaimedAt: claimed!.step.generation!,
      }),
    ).toBe(true);
    expect(() => stepLease.heartbeatStep(deps, w.machineId, stepId)).toThrow(NotFoundError);

    let missingErr: unknown = null;
    try {
      stepLease.heartbeatStep(deps, w.machineId, 'step-does-not-exist');
    } catch (err) {
      missingErr = err;
    }
    expect(missingErr).toBeInstanceOf(HttpError);
    expect((missingErr as HttpError).status).toBe(410);
  });

  test('releaseStepLease honors CAS fences (including machineId = null) and preserves claimedAt', async () => {
    const w = await setupWorkerWorld();
    const deps = machineDepsOf(w.s);
    const first = await machineClaim.claimStep(
      deps,
      w.machineId,
      w.s.team.id,
      0,
      'http://localhost',
    );
    const g1 = first!.step.generation!;

    expect(
      stepLease.releaseStepLease(w.s.db, first!.step.id, {
        expectedMachineId: 'wrong-machine',
        expectedClaimedAt: g1,
      }),
    ).toBe(false);
    expect(
      stepLease.releaseStepLease(w.s.db, first!.step.id, {
        expectedMachineId: w.machineId,
        expectedClaimedAt: g1,
      }),
    ).toBe(true);
    expect(w.stepRow()).toMatchObject({
      status: 'pending',
      machineId: null,
      mcpGrant: null,
      claimedAt: g1,
    });

    w.s.db
      .update(stepTable)
      .set({ status: 'claimed', machineId: null, claimedAt: g1 + 10 })
      .where(eq(stepTable.id, first!.step.id))
      .run();
    expect(
      stepLease.releaseStepLease(w.s.db, first!.step.id, {
        expectedMachineId: 'non-null-machine',
        expectedClaimedAt: g1 + 10,
      }),
    ).toBe(false);
    expect(
      stepLease.releaseStepLease(w.s.db, first!.step.id, {
        expectedMachineId: null,
        expectedClaimedAt: g1 + 10,
      }),
    ).toBe(true);

    w.s.db
      .update(stepTable)
      .set({ status: 'done', machineId: w.machineId, claimedAt: g1 + 20 })
      .where(eq(stepTable.id, first!.step.id))
      .run();
    expect(
      stepLease.releaseStepLease(w.s.db, first!.step.id, {
        expectedMachineId: w.machineId,
        expectedClaimedAt: g1 + 20,
      }),
    ).toBe(false);
    expect(w.stepRow().status).toBe('done');
  });

  test('abandoned worker and chief sweeps skip publish, wake, and question cancellation on CAS miss and release cleanly otherwise', async () => {
    const worker = await setupWorkerWorld();
    const workerClaim = await machineClaim.claimStep(
      machineDepsOf(worker.s),
      worker.machineId,
      worker.s.team.id,
      0,
      'http://localhost',
    );
    expect(workerClaim).not.toBeNull();
    const workerGen = workerClaim!.step.generation!;
    const workerStaleAt = workerGen + BUILD_ABANDONED_STEP_MS + 1000;
    worker.s.db
      .update(machineTable)
      .set({ online: true })
      .where(eq(machineTable.id, worker.machineId))
      .run();

    const workerPublishSpy = vi.spyOn(worker.s.convHub, 'publishStep');
    const workerWakeSpy = vi.spyOn(worker.s.machineHub, 'wake');
    vi.spyOn(worker.s.machineHub, 'silentSinceDrop').mockImplementation(() => {
      worker.s.db
        .update(stepTable)
        .set({
          machineId: 'raced-worker',
          claimedAt: workerGen + 1000,
          lastHeartbeatAt: workerGen + 1000,
        })
        .where(eq(stepTable.id, workerClaim!.step.id))
        .run();
      return true;
    });

    sweepAbandonedBuildSteps(worker.s.svc, workerStaleAt);
    expect(worker.stepRow()).toMatchObject({
      status: 'claimed',
      machineId: 'raced-worker',
      claimedAt: workerGen + 1000,
      claimCount: 0,
    });
    expect(workerPublishSpy).not.toHaveBeenCalled();
    expect(workerWakeSpy).not.toHaveBeenCalled();

    worker.s.db
      .update(stepTable)
      .set({ status: 'pending', machineId: null, claimCount: 0, lastHeartbeatAt: null })
      .where(eq(stepTable.id, workerClaim!.step.id))
      .run();
    for (let i = 0; i < ABANDONED_CLAIM_QUARANTINE_LIMIT; i += 1) {
      worker.s.db
        .update(machineTable)
        .set({ online: true })
        .where(eq(machineTable.id, worker.machineId))
        .run();
      const claimed = await machineClaim.claimStep(
        machineDepsOf(worker.s),
        worker.machineId,
        worker.s.team.id,
        0,
        'http://localhost',
      );
      expect(claimed).not.toBeNull();
      const staleAt = (worker.stepRow().claimedAt ?? Date.now()) + BUILD_ABANDONED_STEP_MS + 1000;
      worker.s.db
        .update(machineTable)
        .set({ online: false })
        .where(eq(machineTable.id, worker.machineId))
        .run();
      sweepAbandonedBuildSteps(worker.s.svc, staleAt);
    }
    expect(worker.stepRow().status).toBe('failed');
    expect(worker.stepRow().claimCount).toBe(ABANDONED_CLAIM_QUARANTINE_LIMIT - 1);

    const chiefWorld = await setupDaemonChiefWorld();
    const chiefClaim = await machineClaim.claimStep(
      machineDepsOf(chiefWorld.s),
      chiefWorld.machineId,
      chiefWorld.s.team.id,
      0,
      'http://localhost',
    );
    expect(chiefClaim).not.toBeNull();
    const chiefGen = chiefClaim!.step.generation!;
    const chiefStaleAt = chiefGen + CHIEF_ABANDONED_STEP_MS + 1000;
    chiefWorld.s.db
      .insert(chiefMessage)
      .values({
        id: 'q-race-1',
        threadId: chiefWorld.threadId,
        role: 'assistant',
        content: pendingQuestionContent('q-race-1'),
        createdAt: 1,
      })
      .run();
    chiefWorld.s.db
      .update(machineTable)
      .set({ online: true })
      .where(eq(machineTable.id, chiefWorld.machineId))
      .run();

    const chiefPublishSpy = vi.spyOn(chiefWorld.s.convHub, 'publishStep');
    const chiefWakeSpy = vi.spyOn(chiefWorld.s.machineHub, 'wake');
    const chiefSilentSpy = vi
      .spyOn(chiefWorld.s.machineHub, 'silentSinceDrop')
      .mockImplementation(() => {
        chiefWorld.s.db
          .update(stepTable)
          .set({
            machineId: 'raced-chief',
            claimedAt: chiefGen + 1000,
            lastHeartbeatAt: chiefGen + 1000,
          })
          .where(eq(stepTable.id, chiefClaim!.step.id))
          .run();
        return true;
      });

    sweepAbandonedChiefSteps(chiefWorld.s.svc, chiefStaleAt);
    expect(chiefWorld.stepRow()).toMatchObject({
      status: 'claimed',
      machineId: 'raced-chief',
      claimedAt: chiefGen + 1000,
      claimCount: 0,
    });
    expect(chiefPublishSpy).not.toHaveBeenCalled();
    expect(chiefWakeSpy).not.toHaveBeenCalled();
    const qAfterRace = chiefWorld.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, 'q-race-1'))
      .get()!;
    expect(askQuestionContentOf(qAfterRace.content)?.status).toBe('pending');

    chiefSilentSpy.mockRestore();
    chiefWorld.s.db
      .update(stepTable)
      .set({ machineId: chiefWorld.machineId, lastHeartbeatAt: null })
      .where(eq(stepTable.id, chiefClaim!.step.id))
      .run();
    chiefWorld.s.db
      .update(machineTable)
      .set({ online: false })
      .where(eq(machineTable.id, chiefWorld.machineId))
      .run();
    sweepAbandonedChiefSteps(chiefWorld.s.svc, chiefGen + 1000 + CHIEF_ABANDONED_STEP_MS + 1000);
    expect(chiefWorld.stepRow()).toMatchObject({
      status: 'pending',
      machineId: null,
      mcpGrant: null,
    });
    expect(chiefPublishSpy).toHaveBeenCalledTimes(1);
    expect(chiefWakeSpy).toHaveBeenCalledTimes(1);
    const qAfterRelease = chiefWorld.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, 'q-race-1'))
      .get()!;
    expect(askQuestionContentOf(qAfterRelease.content)?.status).toBe('cancelled');

    const proj = chiefWorld.s.db.select().from(projectTable).get();
    expect(proj === undefined || typeof proj.id === 'string').toBe(true);
    expect(chiefWorld.s.db.select().from(chiefTable).all().length).toBeGreaterThan(0);
  });

  test('module boundaries are cycle-free and facades preserve export identity', () => {
    const servicesDir = join(import.meta.dirname, '../src/services');
    const stepLeaseSrc = readFileSync(join(servicesDir, 'step-lease.ts'), 'utf8');
    const payloadSrc = readFileSync(join(servicesDir, 'machine-claim-payload.ts'), 'utf8');
    const claimSrc = readFileSync(join(servicesDir, 'machine-claim.ts'), 'utf8');

    expect(stepLeaseSrc).not.toMatch(
      /from '\.\/(?:chief|machines|machine-claim|machine-claim-payload|coordinator-steps|build-abandoned-sweep|machine-deps)\.js'/,
    );
    expect(payloadSrc).not.toMatch(/from '\.\/(?:step-lease|machine-claim|machines)\.js'/);
    expect(claimSrc).not.toMatch(/from '\.\/machines\.js'/);

    expect(machines.claimStep).toBe(machineClaim.claimStep);
    expect(machines.heartbeatStep).toBe(stepLease.heartbeatStep);
    expect(machines.meetsMcpVersionGate).toBe(machineClaimPayload.meetsMcpVersionGate);
    expect(machineClaim.releaseStepLease).toBe(stepLease.releaseStepLease);
    expect(machineClaim.buildChiefClaimPayload).toBe(machineClaimPayload.buildChiefClaimPayload);
    expect(machineClaim.buildWorkerClaimPayload).toBe(machineClaimPayload.buildWorkerClaimPayload);
  });
});
