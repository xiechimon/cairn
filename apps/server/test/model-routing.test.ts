import type { RoutingConnection, RoutingEdge, RoutingQuota } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  antigravitySubscription,
  build,
  chief,
  chiefThread,
  devinSubscription,
  machine,
  project,
  step,
  todo,
} from '../src/db/schema.js';
import { refreshClaudeRateParks } from '../src/services/claude-rate-limit.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { claimStep } from '../src/services/machine-claim.js';
import { createProvider } from '../src/services/providers.js';
import {
  bootServer,
  insertClaudeSubscription,
  insertMachine,
  issueApiKey,
  req,
  seedRoute,
  seedSessionRoute,
} from './helpers.js';

test('a Runner Claude login and its rate windows are no routing connection; a stored subscription is', async () => {
  const s = bootServer();
  const path = `/api/teams/${s.team.id}/model-routing`;
  const id = insertMachine(s, {
    claudeCodeReport: {
      installed: true,
      hostname: 'test',
      models: [],
      auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
    },
  });
  s.db
    .update(machine)
    .set({
      claudeRateLimits: [
        {
          subscription: 'five_hour',
          status: 'allowed',
          utilization: 0.4,
          resetsAt: Date.now() + 10000,
          reportedAt: Date.now(),
        },
      ],
    })
    .where(eq(machine.id, id))
    .run();
  const signedIn = (await (await req(s.app, 'GET', path)).json()) as {
    edges: RoutingEdge[];
    connections: RoutingConnection[];
    quota: RoutingQuota[];
  };
  expect(signedIn.connections).toEqual([]);
  expect(signedIn.quota).toEqual([]);
  expect(signedIn.edges.every((edge) => edge.unavailable === true)).toBe(true);
  const subscriptionId = insertClaudeSubscription(s);
  const subscribed = (await (await req(s.app, 'GET', path)).json()) as {
    edges: RoutingEdge[];
    connections: RoutingConnection[];
  };
  expect(subscribed.connections.map((connection) => connection.id)).toEqual([subscriptionId]);
  for (const edge of subscribed.edges.filter((entry) => entry.modelId.startsWith('claude-'))) {
    expect(edge.connectionId).toBe(subscriptionId);
    expect(edge.unavailable).toBeUndefined();
  }
  expect(JSON.stringify(subscribed)).not.toMatch(/Cipher|apiKey|tokenHash|test-subscription-token/);
  expect((await req(s.app, 'GET', '/api/teams/other/model-routing')).status).toBe(404);
});

test('model-routing reports active Antigravity and Devin subscriptions as available connections', async () => {
  const s = bootServer();
  const path = `/api/teams/${s.team.id}/model-routing`;
  const runnerId = insertMachine(
    s,
    readyMachine({
      online: true,
      capabilities: {
        antigravity: {
          installed: true,
          authenticated: true,
          models: [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
        },
        devin: { installed: true, authenticated: true },
      },
    }),
  );
  s.db
    .insert(antigravitySubscription)
    .values({
      id: 'agy-conn-1',
      teamId: s.team.id,
      label: 'Antigravity',
      tokenCipher: null,
      runnerId,
      models: [],
      enabledAt: Date.now(),
      createdAt: Date.now(),
    })
    .run();
  s.db
    .insert(devinSubscription)
    .values({
      id: 'devin-conn-1',
      teamId: s.team.id,
      label: 'Devin',
      tokenCipher: s.secretBox.seal('wsk-test-token'),
      models: [{ id: 'swe-2-high', name: 'SWE-2 High' }],
      enabledAt: Date.now(),
      createdAt: Date.now(),
    })
    .run();

  const body = (await (await req(s.app, 'GET', path)).json()) as {
    connections: RoutingConnection[];
  };
  expect(body.connections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'agy-conn-1',
        kind: 'subscription',
        available: true,
        models: ['gemini-3.8-flash'],
      }),
      expect.objectContaining({
        id: 'devin-conn-1',
        kind: 'subscription',
        available: true,
        models: ['swe-2-high'],
      }),
    ]),
  );
});

test('a Runner claims a chief step using the default Antigravity subscription when no Coordinator rule is stored', async () => {
  const s = bootServer();
  const runnerId = insertMachine(
    s,
    readyMachine({
      online: true,
      capabilities: {
        antigravity: {
          installed: true,
          authenticated: true,
          models: [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
        },
      },
    }),
  );
  s.db
    .insert(antigravitySubscription)
    .values({
      id: 'agy-claim-sub',
      teamId: s.team.id,
      label: 'Antigravity',
      tokenCipher: null,
      runnerId,
      models: [],
      enabledAt: Date.now(),
      createdAt: Date.now(),
    })
    .run();
  const chiefId = `chief-${s.team.id}`;
  const threadId = `chief-thread-${s.team.id}`;
  s.db
    .insert(chief)
    .values({
      id: chiefId,
      teamId: s.team.id,
      userId: s.user.id,
      createdAt: 1,
    })
    .run();
  s.db
    .insert(chiefThread)
    .values({
      id: threadId,
      chiefId,
      userId: s.user.id,
      teamId: s.team.id,
      title: 'Coordinator',
      sessionId: '',
      sessionRuntime: 'pi',
      sessionOpenedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: 'chief-step-default-agy',
      buildId: threadId,
      kind: 'chief',
      prompt: 'hi',
      createdAt: 1,
    })
    .run();
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
  };
  setCoordinatorInServer(true);
  try {
    const claimed = await claimStep(deps, runnerId, s.team.id, 0, 'http://localhost');
    expect(claimed).toMatchObject({
      step: { id: 'chief-step-default-agy' },
      agent: { provider: 'antigravity', modelId: 'gemini-3.8-flash' },
    });
  } finally {
    setCoordinatorInServer(false);
  }
});

test('a non-Claude model using Anthropic messages stays runnable under subscription-only', async () => {
  const s = bootServer();
  const mid = insertMachine(s);
  createProvider(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      createdBy: s.user.id,
      body: {
        providerId: 'kimi',
        label: 'Kimi',
        api: 'anthropic-messages',
        baseUrl: 'http://localhost:9',
        apiKey: 'test-key',
        models: [{ id: 'kimi-k2', name: 'Kimi K2' }],
      },
    },
  );
  const body = (await (
    await req(s.app, 'GET', `/api/teams/${s.team.id}/model-routing`)
  ).json()) as { connections: RoutingConnection[] };
  expect(body.connections.some((entry) => entry.models.includes('kimi-k2'))).toBe(true);
  expect.soft(body.connections.filter((entry) => entry.vendor === 'anthropic')).toEqual([]);
  seedSessionRoute(s, { provider: 'kimi', modelId: 'kimi-k2', machineId: mid });
  s.db.insert(project).values({ id: 'project', teamId: s.team.id, name: 'Project' }).run();
  s.db
    .insert(todo)
    .values({
      id: 'task',
      teamId: s.team.id,
      projectId: 'project',
      title: 'Task',
      phaseAt: 1,
      seqNum: 1,
    })
    .run();
  s.db
    .insert(build)
    .values({ id: 'run', todoId: 'task', withPlan: false, triggerSource: 'user', createdAt: 1 })
    .run();
  s.db.insert(step).values({ id: 'pending', buildId: 'run', kind: 'build', createdAt: 1 }).run();
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
  };
  refreshClaudeRateParks(deps, s.team.id);
  expect(s.db.select().from(step).where(eq(step.id, 'pending')).get()).toMatchObject({
    status: 'pending',
    quotaBlock: null,
  });
  expect(await claimStep(deps, mid, s.team.id, 0, 'http://localhost')).toMatchObject({
    step: { id: 'pending' },
    agent: { provider: 'kimi', modelId: 'kimi-k2' },
  });
});

test('Codex routing omits quota windows without a server usage source', async () => {
  const s = bootServer();
  createProvider(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      createdBy: s.user.id,
      body: {
        providerId: 'openai-codex',
        label: 'Codex',
        api: 'openai-responses',
        baseUrl: 'http://localhost:9',
        apiKey: 'test-key',
        models: [{ id: 'gpt-6.1-sol', name: 'Sol' }],
      },
    },
  );
  const body = (await (
    await req(s.app, 'GET', `/api/teams/${s.team.id}/model-routing`)
  ).json()) as {
    edges: RoutingEdge[];
    quota: RoutingQuota[];
  };
  expect(body.edges.find((edge) => edge.use === 'implementation')).toMatchObject({
    modelId: 'gpt-6.1-sol',
    connectionId: expect.any(String),
  });
  expect(body.quota).toEqual([]);
  expect(body.edges.some((edge) => edge.reason === 'codex-quota<=30%')).toBe(false);
});

test.each([
  { triggerSource: 'user', mode: 'direct' },
  { triggerSource: 'schedule', mode: 'direct' },
  { triggerSource: 'user', mode: 'fallback' },
  { triggerSource: 'user', mode: 'native' },
  { triggerSource: 'user', mode: 'takeover' },
] as const)(
  '$triggerSource $mode paid Claude step is claimed without a usage opt-in',
  async ({ triggerSource, mode }) => {
    const s = bootServer();
    insertClaudeSubscription(s);
    const mid = insertMachine(
      s,
      mode === 'native' || mode === 'takeover'
        ? {
            claudeCodeReport: {
              installed: true,
              hostname: 'test',
              models: [{ id: 'claude-sonnet-5-5', name: 'Sonnet' }],
              auth: {
                state: 'logged-in',
                method: mode === 'takeover' ? 'claude.ai' : 'api_key',
                provider: 'firstParty',
              },
            },
          }
        : {},
    );
    let claimant = mid;
    if (mode === 'takeover') {
      s.db
        .update(machine)
        .set({
          claudeRateLimits: [
            {
              subscription: 'five_hour',
              status: 'rejected',
              utilization: 1,
              resetsAt: Date.now() + 100000,
              reportedAt: Date.now(),
            },
          ],
        })
        .where(eq(machine.id, mid))
        .run();
      claimant = insertMachine(s, {
        name: 'spare',
        claudeCodeReport: {
          installed: true,
          hostname: 'spare',
          models: [{ id: 'claude-sonnet-5-5', name: 'Sonnet' }],
          auth: { state: 'logged-in', method: 'api_key' },
        },
      });
    }
    if (mode !== 'takeover') {
      createProvider(
        { db: s.db, box: s.secretBox },
        {
          teamId: s.team.id,
          createdBy: s.user.id,
          body: {
            providerId: 'anthropic',
            label: 'Claude key',
            api: 'anthropic-messages',
            baseUrl: 'http://localhost:9',
            apiKey: 'test-key',
            models: [{ id: 'claude-sonnet-5-5', name: 'Sonnet' }],
          },
        },
      );
    }
    const workerRoute = {
      provider:
        mode === 'native' || mode === 'takeover'
          ? 'claude-code'
          : mode === 'fallback'
            ? 'openai'
            : 'anthropic',
      modelId: mode === 'fallback' ? 'gpt-6.1-sol' : 'claude-sonnet-5-5',
      machineId: mid,
    };
    seedSessionRoute(s, workerRoute);
    seedRoute(s, 'coordinator', workerRoute);
    s.db.insert(project).values({ id: 'project', teamId: s.team.id, name: 'Project' }).run();
    s.db
      .insert(todo)
      .values({
        id: 'task',
        teamId: s.team.id,
        projectId: 'project',
        title: 'Task',
        phaseAt: 1,
        seqNum: 1,
      })
      .run();
    s.db
      .insert(build)
      .values({ id: 'run', todoId: 'task', withPlan: false, triggerSource, createdAt: 1 })
      .run();
    const fallback =
      mode === 'fallback'
        ? {
            model: { provider: 'anthropic', modelId: 'claude-sonnet-5-5' },
            tried: ['openai/gpt-6.1-sol'],
            zeroUsageRetried: false,
          }
        : null;
    s.db
      .insert(step)
      .values({ id: 'pending', buildId: 'run', kind: 'build', createdAt: 1, fallback })
      .run();
    s.db
      .insert(step)
      .values({
        id: 'running',
        buildId: 'run',
        kind: 'build',
        createdAt: 2,
        status: 'claimed',
        machineId: mid,
      })
      .run();
    s.db
      .insert(chief)
      .values({
        id: 'coordinator',
        userId: s.user.id,
        teamId: s.team.id,
        createdAt: 1,
      })
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: 'chief:thread',
        chiefId: 'coordinator',
        userId: s.user.id,
        teamId: s.team.id,
        title: 'Thread',
        createdAt: 1,
        updatedAt: 1,
        sessionId: '',
        sessionOpenedAt: 1,
      })
      .run();
    s.db
      .insert(step)
      .values({
        id: 'coordinator-step',
        buildId: 'chief:thread',
        kind: 'chief',
        createdAt: 3,
        fallback,
      })
      .run();
    const deps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
    };
    const claimed = await claimStep(deps, claimant, s.team.id, 0, 'http://localhost');
    if (mode === 'takeover') {
      expect(claimed).toBeNull();
      expect(s.db.select().from(step).where(eq(step.id, 'pending')).get()).toMatchObject({
        status: 'waiting_quota',
        machineId: null,
        quotaBlock: {
          source: 'claude_rate_limit',
          reason: 'Claude subscription five_hour rejected',
        },
      });
    } else {
      expect(claimed).toMatchObject({
        step: { id: 'pending' },
        agent: { provider: mode === 'native' ? 'claude-code' : 'anthropic' },
      });
    }
  },
);

test.each([
  { state: 'logged-in' as const, method: 'claude.ai', provider: 'firstParty' },
  { state: 'logged-in' as const, method: 'oauth_token', provider: 'firstParty' },
  { state: 'logged-in' as const, method: 'api_key', provider: 'firstParty' },
  { state: 'not-logged-in' as const, provider: 'firstParty' },
  { state: 'unknown' as const, reason: 'probe failed' },
])('a Runner reporting Claude auth $state $method is no routing connection', async (auth) => {
  const s = bootServer();
  insertMachine(s, { claudeCodeReport: { installed: true, hostname: 'test', models: [], auth } });
  const body = (await (
    await req(s.app, 'GET', `/api/teams/${s.team.id}/model-routing`)
  ).json()) as { connections: RoutingConnection[]; quota: RoutingQuota[] };
  expect(body.connections).toEqual([]);
  expect(body.quota).toEqual([]);
});

test.each([
  { state: 'ok', expiry: 'future', online: true },
  { state: 'expired', expiry: 'past', online: true },
  { state: 'ok', expiry: 'none', online: false },
])(
  'a Runner Codex login is no routing connection: $state/$expiry online=$online',
  async ({ state, expiry, online }) => {
    const s = bootServer();
    const apiKey = await issueApiKey(s);
    const enrolled = await s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(readyMachine({ teamId: s.team.id, name: 'codex-machine' })),
    });
    expect(enrolled.status).toBe(200);
    const { machineId: id, token } = (await enrolled.json()) as {
      machineId: string;
      token: string;
    };
    const login = {
      state,
      ...(expiry === 'none'
        ? {}
        : { expiresAt: Date.now() + (expiry === 'future' ? 60_000 : -60_000) }),
    };
    const presence = await s.app.request('/api/machine/presence', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: { mcpServers: [], skills: [], codexLogin: login } }),
    });
    expect(presence.status).toBe(200);
    s.db.update(machine).set({ online }).where(eq(machine.id, id)).run();
    const body = (await (
      await req(s.app, 'GET', `/api/teams/${s.team.id}/model-routing`)
    ).json()) as { connections: RoutingConnection[]; edges: RoutingEdge[] };
    expect(body.connections).toEqual([]);
    expect(body.edges.find((edge) => edge.use === 'implementation')?.unavailable).toBe(true);
  },
);
