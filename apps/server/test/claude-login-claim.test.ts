import { createHash } from 'node:crypto';
import type { ClaudeAuthStateWire, ClaudeCodeReport } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { hasActiveClaudeSubscription } from '../src/services/claude-subscriptions.js';
import { claimStep, markPresence } from '../src/services/machines.js';
import {
  bootServer,
  insertMachine,
  issueApiKey,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

let seq = 9_400;

function claimAs(s: TestServer, machineId: string) {
  return claimStep(
    {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
    },
    machineId,
    s.team.id,
    10,
    'http://localhost',
  );
}

function report(login?: {
  state: 'ok' | 'expiring' | 'expired' | 'unknown';
  expiresAt?: number;
}): ClaudeCodeReport {
  return {
    installed: true,
    hostname: 'omarchy',
    models: [],
    auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
    ...(login !== undefined ? { login } : {}),
  } as ClaudeCodeReport;
}

async function world(): Promise<{ s: TestServer; projectId: string }> {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  disposables.push(() => s.dispose());
  const projectId = await postProject(s.app, 'claude-login');
  return { s, projectId };
}

function insertAgent(
  s: TestServer,
  opts: { id: string; machineId: string; provider: string },
): void {
  s.db
    .insert(agentTable)
    .values({
      id: opts.id,
      teamId: s.team.id,
      displayName: opts.id,
      provider: opts.provider,
      modelId: 'stub-model',
      thinkingLevel: 'off',
      machineId: opts.machineId,
    })
    .run();
}

function insertBuildStep(s: TestServer, projectId: string, agentId: string): string {
  seq += 1;
  const suffix = `${seq}`;
  const todoId = `todo-login-${suffix}`;
  const buildId = `build-login-${suffix}`;
  const stepId = `step-login-${suffix}`;
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      seqNum: seq,
      title: `login probe ${suffix}`,
      spec: '',
      phase: 'queued',
      phaseAt: seq,
      assignment: { plan: null, build: { agentId } },
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: seq,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt: seq,
    })
    .run();
  return stepId;
}

function stepStatus(s: TestServer, stepId: string): string {
  return s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status;
}

function insertChief(s: TestServer, machineId: string, provider: string): string {
  const agentId = `agent-chief-${provider}-${machineId}`;
  insertAgent(s, { id: agentId, machineId, provider });
  const chiefId = `chief-login-${machineId}`;
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      agentId,
      charter: '',
      createdAt: 1,
    })
    .run();
  const threadId = `chief-thread-login-${machineId}`;
  s.db
    .insert(chiefThreadTable)
    .values({
      id: threadId,
      chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: 'login probe',
      createdAt: 2,
      updatedAt: 2,
      sessionId: '',
      sessionOpenedAt: 2,
    })
    .run();
  const stepId = `step-chief-login-${machineId}`;
  s.db
    .insert(stepTable)
    .values({ id: stepId, buildId: threadId, kind: 'chief', status: 'pending', createdAt: 3 })
    .run();
  return stepId;
}

const subscriptionAuthCases: {
  name: string;
  auth?: ClaudeAuthStateWire;
  noReport?: boolean;
  subscription: boolean;
}[] = [
  { name: 'no report', noReport: true, subscription: false },
  { name: 'no auth', subscription: false },
  { name: 'failed probe', auth: { state: 'unknown', reason: 'probe failed' }, subscription: false },
  {
    name: 'not logged in',
    auth: { state: 'not-logged-in', method: 'claude.ai', provider: 'firstParty' },
    subscription: false,
  },
  {
    name: 'unknown method',
    auth: { state: 'logged-in', method: 'unknown', provider: 'firstParty' },
    subscription: false,
  },
  {
    name: 'missing method',
    auth: { state: 'logged-in', provider: 'firstParty' },
    subscription: false,
  },
  {
    name: 'missing provider',
    auth: { state: 'logged-in', method: 'claude.ai' },
    subscription: false,
  },
  {
    name: 'bedrock',
    auth: { state: 'logged-in', method: 'claude.ai', provider: 'bedrock' },
    subscription: false,
  },
  {
    name: 'vertex',
    auth: { state: 'logged-in', method: 'oauth_token', provider: 'vertex' },
    subscription: false,
  },
  {
    name: 'API key',
    auth: { state: 'logged-in', method: 'api_key', provider: 'firstParty' },
    subscription: false,
  },
  {
    name: 'native subscription',
    auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
    subscription: true,
  },
  {
    name: 'OAuth token subscription',
    auth: { state: 'logged-in', method: 'oauth_token', provider: 'firstParty' },
    subscription: true,
  },
];

describe.each(['subscription-only', 'allow-paid'] as const)('%s machine auth', (claudeUsage) => {
  describe.each(['build', 'chief'] as const)('%s claim', (kind) => {
    describe.each(['owner', 'spare'] as const)('%s', (role) => {
      test.each(subscriptionAuthCases)('$name', async ({ auth, noReport, subscription }) => {
        const { s, projectId } = await world();
        s.db.update(teamTable).set({ claudeUsage }).where(eq(teamTable.id, s.team.id)).run();
        const ownerId = insertMachine(s, {
          name: 'auth-owner',
          claudeCodeReport: {
            ...report(),
            auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
          },
        });
        const claimantId = role === 'owner' ? ownerId : insertMachine(s, { name: 'auth-spare' });
        s.db
          .update(machineTable)
          .set({ claudeCodeReport: noReport ? null : { ...report(), auth } })
          .where(eq(machineTable.id, claimantId))
          .run();
        if (role === 'spare') {
          s.db
            .update(machineTable)
            .set({
              claudeRateLimits: [
                {
                  subscription: 'five_hour',
                  status: 'rejected',
                  utilization: 1,
                  resetsAt: Date.now() + 3_600_000,
                  reportedAt: Date.now(),
                },
              ],
            })
            .where(eq(machineTable.id, ownerId))
            .run();
        }
        const stepId =
          kind === 'chief'
            ? insertChief(s, ownerId, 'claude-code')
            : (() => {
                insertAgent(s, { id: 'auth-builder', machineId: ownerId, provider: 'claude-code' });
                return insertBuildStep(s, projectId, 'auth-builder');
              })();
        const claimed = await claimAs(s, claimantId);
        if (claudeUsage === 'allow-paid' || subscription) {
          expect(claimed?.step).toMatchObject({ id: stepId, machineId: claimantId });
        } else {
          expect(claimed).toBeNull();
          expect(s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()).toMatchObject(
            {
              status: 'waiting_quota',
              machineId: null,
              quotaBlock:
                role === 'spare'
                  ? {
                      source: 'claude_rate_limit',
                      reason: 'Claude subscription five_hour rejected',
                    }
                  : { source: 'subscription_policy', reason: 'subscription-only' },
            },
          );
        }
      });
    });
  });
});

describe('claimStep and Claude Code login expiry', () => {
  test('an expired login is not given its pinned claude-code step; the step stays pending', async () => {
    const { s, projectId } = await world();
    const expiredId = insertMachine(s, {
      name: 'expired-host',
      claudeCodeReport: report({ state: 'expired', expiresAt: Date.now() - 3_600_000 }),
    });
    insertAgent(s, { id: 'agent-expired', machineId: expiredId, provider: 'claude-code' });
    const stepId = insertBuildStep(s, projectId, 'agent-expired');
    expect(await claimAs(s, expiredId)).toBeNull();
    expect(stepStatus(s, stepId)).toBe('pending');
  });

  test('a healthy machine still claims the claude-code step pinned to it', async () => {
    const { s, projectId } = await world();
    insertMachine(s, {
      name: 'expired-other',
      claudeCodeReport: report({ state: 'expired', expiresAt: Date.now() - 3_600_000 }),
    });
    const healthyId = insertMachine(s, {
      name: 'healthy-host',
      claudeCodeReport: report({ state: 'ok', expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 }),
    });
    insertAgent(s, { id: 'agent-healthy', machineId: healthyId, provider: 'claude-code' });
    const stepId = insertBuildStep(s, projectId, 'agent-healthy');
    const claimed = await claimAs(s, healthyId);
    expect(claimed?.step.id).toBe(stepId);
  });

  test('unknown, missing, and still-valid expiring logins do not block claude-code claim', async () => {
    const cases = [
      report({ state: 'unknown', expiresAt: Date.now() - 1 }),
      report(),
      report({ state: 'expiring', expiresAt: Date.now() + 2 * 24 * 60 * 60 * 1000 }),
    ];
    for (const [index, claudeCodeReport] of cases.entries()) {
      const { s, projectId } = await world();
      const machineId = insertMachine(s, { name: `open-${index}`, claudeCodeReport });
      const agentId = `agent-open-${index}`;
      insertAgent(s, { id: agentId, machineId, provider: 'claude-code' });
      const stepId = insertBuildStep(s, projectId, agentId);
      const claimed = await claimAs(s, machineId);
      expect(claimed?.step.id).toBe(stepId);
    }
  });

  test('a clock that has passed blocks even when the stored label is still expiring', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, {
      name: 'stale-expiring',
      claudeCodeReport: report({ state: 'expiring', expiresAt: Date.now() - 1 }),
    });
    insertAgent(s, { id: 'agent-stale', machineId, provider: 'claude-code' });
    const stepId = insertBuildStep(s, projectId, 'agent-stale');
    expect(await claimAs(s, machineId)).toBeNull();
    expect(stepStatus(s, stepId)).toBe('pending');
  });

  test('pi steps on an expired claude-code machine are still claimed', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, {
      name: 'expired-pi',
      claudeCodeReport: report({ state: 'expired', expiresAt: Date.now() - 3_600_000 }),
    });
    insertAgent(s, { id: 'agent-pi', machineId, provider: 'stub-gw' });
    const stepId = insertBuildStep(s, projectId, 'agent-pi');
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe(stepId);
  });

  test('a chief claude-code step is not claimed by an expired login', async () => {
    const { s } = await world();
    const machineId = insertMachine(s, {
      name: 'expired-chief',
      claudeCodeReport: report({ state: 'expired', expiresAt: Date.now() - 3_600_000 }),
    });
    const stepId = insertChief(s, machineId, 'claude-code');
    expect(await claimAs(s, machineId)).toBeNull();
    expect(stepStatus(s, stepId)).toBe('pending');
  });

  test('a chief step with an unknown login is still claimed', async () => {
    const { s } = await world();
    const machineId = insertMachine(s, {
      name: 'unknown-chief',
      claudeCodeReport: report({ state: 'unknown', expiresAt: Date.now() - 1 }),
    });
    const stepId = insertChief(s, machineId, 'claude-code');
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe(stepId);
  });
});

describe('presence stores Claude Code login and the machine record exposes it', () => {
  test('online login changes notify the team without repeating unchanged heartbeats', async () => {
    const { s } = await world();
    const machineId = insertMachine(s, {
      name: 'online-login',
      claudeCodeReport: report({ state: 'ok' }),
    });
    const events: object[] = [];
    s.hub.subscribe(s.team.id, {
      nextSeq: () => 1,
      send: async (event: object) => {
        events.push(event);
      },
    });
    const deps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
    };
    const expiresAt = Date.now() + 1000;
    markPresence(deps, machineId, { claudeCode: report({ state: 'expiring', expiresAt }) });
    expect(events).toEqual([{ type: 'machine_presence', machineId, online: true }]);
    markPresence(deps, machineId, { claudeCode: report({ state: 'expiring', expiresAt }) });
    markPresence(deps, machineId, {});
    expect(events).toHaveLength(1);
    markPresence(deps, machineId, { claudeCode: report({ state: 'ok' }) });
    expect(events).toHaveLength(2);
  });

  test('presence keeps login, and the team machine list returns claudeLogin', async () => {
    const { s } = await world();
    const apiKey = await issueApiKey(s);
    const enrolled = await s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: s.team.id, name: 'omarchy', cliVersion: '0.1.0' }),
    });
    expect(enrolled.status).toBe(200);
    const { machineId, token } = (await enrolled.json()) as { machineId: string; token: string };
    const expiresAt = Date.now() + 2 * 24 * 60 * 60 * 1000;
    const presence = await s.app.request('/api/machine/presence', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        cliVersion: '0.1.0',
        claudeCode: {
          installed: true,
          hostname: 'omarchy',
          models: [],
          login: { state: 'expiring', expiresAt },
        },
      }),
    });
    expect(presence.status).toBe(200);
    const row = s.db.select().from(machineTable).where(eq(machineTable.id, machineId)).get();
    expect((row?.claudeCodeReport as { login?: unknown } | null)?.login).toEqual({
      state: 'expiring',
      expiresAt,
    });
    const list = await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`);
    expect(list.status).toBe(200);
    const machines = (await list.json()) as { id: string; claudeLogin?: unknown }[];
    expect(machines.find((machine) => machine.id === machineId)?.claudeLogin).toEqual({
      state: 'expiring',
      expiresAt,
    });
  });
});

describe('subscription login takes precedence over expired machine login', () => {
  test.each(['build', 'chief'] as const)(
    '%s claims with a subscription and delivers it only over the owned credential endpoint',
    async (kind) => {
      const { s, projectId } = await world();
      const machineId = insertMachine(s, {
        name: `subscription-${kind}`,
        claudeCodeReport: report({ state: 'expired', expiresAt: 1 }),
      });
      const stepId =
        kind === 'chief'
          ? insertChief(s, machineId, 'claude-code')
          : (() => {
              insertAgent(s, { id: 'subscription-builder', machineId, provider: 'claude-code' });
              return insertBuildStep(s, projectId, 'subscription-builder');
            })();
      const token =
        'sk-ant-oat01-private-subscription-claim-token-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
      const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions`, {
        label: 'Personal',
        token,
        expiresAt: Date.now() + 86400000,
      });
      expect(created.status).toBe(201);
      const events: object[] = [];
      s.hub.subscribe(s.team.id, {
        nextSeq: () => 1,
        send: async (event: object) => {
          events.push(event);
        },
      });
      const claimed = await claimAs(s, machineId);
      expect(claimed?.step.id).toBe(stepId);
      expect(JSON.stringify({ claimed, events })).not.toContain(token);
      const machineToken = 'machine-subscription-auth';
      s.db
        .update(machineTable)
        .set({ tokenHash: createHash('sha256').update(machineToken).digest('hex') })
        .where(eq(machineTable.id, machineId))
        .run();
      const credentialResponse = await s.app.request(`/api/machine/token/${stepId}`, {
        headers: { authorization: `Bearer ${machineToken}` },
      });
      expect(credentialResponse.status).toBe(200);
      expect(await credentialResponse.json()).toMatchObject({ claudeSubscriptionToken: token });
      for (const status of ['done', 'failed', 'stopped', 'waiting_quota', 'pending'] as const) {
        s.db.update(stepTable).set({ status }).where(eq(stepTable.id, stepId)).run();
        const finished = await s.app.request(`/api/machine/token/${stepId}`, {
          headers: { authorization: `Bearer ${machineToken}` },
        });
        expect(finished.status).toBe(200);
        const body = await finished.text();
        expect(body).not.toContain(token);
        expect(JSON.parse(body)).not.toHaveProperty('claudeSubscriptionToken');
      }
      s.db.update(stepTable).set({ status: 'claimed' }).where(eq(stepTable.id, stepId)).run();
      const otherMachineId = insertMachine(s, { name: 'other-machine' });
      const otherToken = 'other-machine-auth';
      s.db
        .update(machineTable)
        .set({ tokenHash: createHash('sha256').update(otherToken).digest('hex') })
        .where(eq(machineTable.id, otherMachineId))
        .run();
      const denied = await s.app.request(`/api/machine/token/${stepId}`, {
        headers: { authorization: `Bearer ${otherToken}` },
      });
      expect(denied.status).toBe(404);
      expect(await denied.text()).not.toContain(token);
      s.db
        .update(stepTable)
        .set({
          fallback: {
            model: { provider: 'stub-gw', modelId: 'stub-model' },
            tried: [],
            zeroUsageRetried: false,
          },
        })
        .where(eq(stepTable.id, stepId))
        .run();
      const piCredentials = await s.app.request(`/api/machine/token/${stepId}`, {
        headers: { authorization: `Bearer ${machineToken}` },
      });
      expect(piCredentials.status).toBe(200);
      expect(await piCredentials.text()).not.toContain(token);
    },
  );
  test('an expired subscription does not bypass expired machine login', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, {
      name: 'expired-both',
      claudeCodeReport: report({ state: 'expired', expiresAt: 1 }),
    });
    insertAgent(s, { id: 'expired-subscription-builder', machineId, provider: 'claude-code' });
    insertBuildStep(s, projectId, 'expired-subscription-builder');
    await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions`, {
      label: 'Expired',
      token:
        'sk-ant-oat01-expired-subscription-token-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
      expiresAt: 1,
    });
    expect(await claimAs(s, machineId)).toBeNull();
  });
});

test('team-scoped revocation removes future credentials and restores the machine login gate', async () => {
  const { s, projectId } = await world();
  const machineId = insertMachine(s, {
    name: 'revoked-subscription',
    claudeCodeReport: report({ state: 'expired', expiresAt: 1 }),
  });
  insertAgent(s, { id: 'revocation-builder', machineId, provider: 'claude-code' });
  const token = `sk-ant-oat01-${'r'.repeat(64)}`;
  const path = `/api/teams/${s.team.id}/claude-subscriptions`;
  const response = await req(s.app, 'POST', path, { label: 'Revocable', token });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const firstStep = insertBuildStep(s, projectId, 'revocation-builder');
  expect((await claimAs(s, machineId))?.step.id).toBe(firstStep);
  const machineToken = 'revocation-machine-auth';
  s.db
    .update(machineTable)
    .set({ tokenHash: createHash('sha256').update(machineToken).digest('hex') })
    .where(eq(machineTable.id, machineId))
    .run();
  const headers = { authorization: `Bearer ${machineToken}` };
  expect(
    await (await s.app.request(`/api/machine/token/${firstStep}`, { headers })).json(),
  ).toMatchObject({ claudeSubscriptionToken: token });
  expect((await req(s.app, 'DELETE', `/api/teams/other/claude-subscriptions/${id}`)).status).toBe(
    404,
  );
  expect((await req(s.app, 'DELETE', `${path}/missing`)).status).toBe(404);
  expect(hasActiveClaudeSubscription({ db: s.db }, s.team.id)).toBe(true);
  expect((await req(s.app, 'DELETE', `${path}/${id}`)).status).toBe(204);
  expect((await req(s.app, 'DELETE', `${path}/${id}`)).status).toBe(404);
  expect(hasActiveClaudeSubscription({ db: s.db }, s.team.id)).toBe(false);
  const nextStep = insertBuildStep(s, projectId, 'revocation-builder');
  expect(await claimAs(s, machineId)).toBeNull();
  s.db
    .update(stepTable)
    .set({ machineId, status: 'claimed' })
    .where(eq(stepTable.id, nextStep))
    .run();
  const nextCredentials = await s.app.request(`/api/machine/token/${nextStep}`, { headers });
  expect(nextCredentials.status).toBe(200);
  expect(await nextCredentials.text()).not.toContain(token);
});
