import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ClaudeAuthStateWire, ClaudeCodeReport } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  claudeSubscription as claudeSubscriptionTable,
  machine as machineTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { hasActiveClaudeSubscription } from '../src/services/claude-subscriptions.js';
import { claimPendingChiefStep } from '../src/services/coordinator-steps.js';
import { claimStep, markPresence } from '../src/services/machines.js';
import {
  bootServer,
  insertClaudeSubscription,
  insertMachine,
  issueApiKey,
  postProject,
  req,
  seedRoute,
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
    models: [{ id: 'stub-model', name: 'stub-model' }],
    auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
    ...(login !== undefined ? { login } : {}),
  } as ClaudeCodeReport;
}

async function world(
  opts: { subscription?: boolean } = {},
): Promise<{ s: TestServer; projectId: string }> {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  disposables.push(() => s.dispose());
  if (opts.subscription === true) insertClaudeSubscription(s);
  const projectId = await postProject(s.app, 'claude-login');
  return { s, projectId };
}

function routeSession(s: TestServer, opts: { machineId: string; provider: string }): void {
  seedRoute(s, 'session', {
    provider: opts.provider,
    modelId: 'stub-model',
    thinkingLevel: 'off',
    machineId: opts.machineId,
  });
}

function insertBuildStep(s: TestServer, projectId: string): string {
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
  seedRoute(s, 'coordinator', { provider, modelId: 'stub-model', thinkingLevel: 'off', machineId });
  const chiefId = `chief-login-${machineId}`;
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
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
}[] = [
  { name: 'no report', noReport: true },
  { name: 'no auth' },
  { name: 'failed probe', auth: { state: 'unknown', reason: 'probe failed' } },
  {
    name: 'not logged in',
    auth: { state: 'not-logged-in', method: 'claude.ai', provider: 'firstParty' },
  },
  {
    name: 'unknown method',
    auth: { state: 'logged-in', method: 'unknown', provider: 'firstParty' },
  },
  {
    name: 'missing method',
    auth: { state: 'logged-in', provider: 'firstParty' },
  },
  {
    name: 'missing provider',
    auth: { state: 'logged-in', method: 'claude.ai' },
  },
  {
    name: 'bedrock',
    auth: { state: 'logged-in', method: 'claude.ai', provider: 'bedrock' },
  },
  {
    name: 'vertex',
    auth: { state: 'logged-in', method: 'oauth_token', provider: 'vertex' },
  },
  {
    name: 'API key',
    auth: { state: 'logged-in', method: 'api_key', provider: 'firstParty' },
  },
  {
    name: 'native subscription',
    auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
  },
  {
    name: 'OAuth token subscription',
    auth: { state: 'logged-in', method: 'oauth_token', provider: 'firstParty' },
  },
];

describe('machine auth', () => {
  describe.each(['build', 'chief'] as const)('%s claim', (kind) => {
    describe.each(['owner', 'spare'] as const)('%s', (role) => {
      test.each(subscriptionAuthCases)('$name', async ({ auth, noReport }) => {
        const { s, projectId } = await world({ subscription: true });
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
                routeSession(s, { machineId: ownerId, provider: 'claude-code' });
                return insertBuildStep(s, projectId);
              })();
        const claimed = await claimAs(s, claimantId);
        if (role === 'spare') {
          expect(claimed).toBeNull();
          expect(
            s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()?.machineId,
          ).toBe(null);
        } else if (noReport) {
          expect(claimed).toBeNull();
          expect(s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()).toMatchObject(
            { status: 'pending', machineId: null },
          );
        } else {
          expect(claimed?.step).toMatchObject({ id: stepId, machineId: claimantId });
        }
      });
    });
  });
});

describe('claimStep and the Runner Claude login', () => {
  const loginReports = () => [
    report({ state: 'expired', expiresAt: Date.now() - 3_600_000 }),
    report({ state: 'expiring', expiresAt: Date.now() - 1 }),
    report({ state: 'unknown', expiresAt: Date.now() - 1 }),
    report({ state: 'ok', expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 }),
    report(),
  ];

  test('with a team subscription, every Runner login state claims the claude-code step', async () => {
    for (const [index, claudeCodeReport] of loginReports().entries()) {
      const { s, projectId } = await world({ subscription: true });
      const machineId = insertMachine(s, { name: `subscribed-${index}`, claudeCodeReport });
      routeSession(s, { machineId, provider: 'claude-code' });
      const stepId = insertBuildStep(s, projectId);
      expect((await claimAs(s, machineId))?.step.id).toBe(stepId);
    }
  });

  test('without a team subscription, no Runner login state claims the claude-code step', async () => {
    for (const [index, claudeCodeReport] of loginReports().entries()) {
      const { s, projectId } = await world();
      const machineId = insertMachine(s, { name: `unsubscribed-${index}`, claudeCodeReport });
      routeSession(s, { machineId, provider: 'claude-code' });
      const stepId = insertBuildStep(s, projectId);
      expect(await claimAs(s, machineId)).toBeNull();
      expect(stepStatus(s, stepId)).toBe('pending');
    }
  });

  test('pi steps are claimed without a subscription whatever the Claude login', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, {
      name: 'expired-pi',
      claudeCodeReport: report({ state: 'expired', expiresAt: Date.now() - 3_600_000 }),
    });
    routeSession(s, { machineId, provider: 'stub-gw' });
    const stepId = insertBuildStep(s, projectId);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe(stepId);
  });

  test('a chief claude-code step needs a subscription, not a Runner login', async () => {
    const { s } = await world();
    const machineId = insertMachine(s, {
      name: 'signed-in-chief',
      claudeCodeReport: report({ state: 'ok' }),
    });
    const stepId = insertChief(s, machineId, 'claude-code');
    expect(await claimAs(s, machineId)).toBeNull();
    expect(stepStatus(s, stepId)).toBe('pending');
    insertClaudeSubscription(s);
    expect((await claimAs(s, machineId))?.step.id).toBe(stepId);
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
      body: JSON.stringify(
        readyMachine({ teamId: s.team.id, name: 'omarchy', cliVersion: '0.1.0' }),
      ),
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
              routeSession(s, { machineId, provider: 'claude-code' });
              return insertBuildStep(s, projectId);
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
  test('an expired subscription does not let a claude-code step run', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, {
      name: 'expired-both',
      claudeCodeReport: report({ state: 'expired', expiresAt: 1 }),
    });
    routeSession(s, { machineId, provider: 'claude-code' });
    insertBuildStep(s, projectId);
    await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions`, {
      label: 'Expired',
      token:
        'sk-ant-oat01-expired-subscription-token-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
      expiresAt: 1,
    });
    expect(await claimAs(s, machineId)).toBeNull();
  });
});

test('team-scoped revocation removes future credentials and stops claude-code claims', async () => {
  const { s, projectId } = await world();
  const machineId = insertMachine(s, {
    name: 'revoked-subscription',
    claudeCodeReport: report({ state: 'expired', expiresAt: 1 }),
  });
  routeSession(s, { machineId, provider: 'claude-code' });
  const token = `sk-ant-oat01-${'r'.repeat(64)}`;
  const path = `/api/teams/${s.team.id}/claude-subscriptions`;
  const response = await req(s.app, 'POST', path, { label: 'Revocable', token });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const firstStep = insertBuildStep(s, projectId);
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
  s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, firstStep)).run();
  expect((await req(s.app, 'DELETE', `${path}/${id}`)).status).toBe(204);
  expect((await req(s.app, 'DELETE', `${path}/${id}`)).status).toBe(404);
  expect(hasActiveClaudeSubscription({ db: s.db }, s.team.id)).toBe(false);
  const nextStep = insertBuildStep(s, projectId);
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

describe('several stored subscriptions, one enabled', () => {
  const tokenOf = (letter: string) => `sk-ant-oat01-${letter.repeat(64)}`;

  async function save(s: TestServer, label: string, letter: string, expiresAt?: number) {
    const response = await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions`, {
      label,
      token: tokenOf(letter),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  function rows(s: TestServer) {
    return s.db.select().from(claudeSubscriptionTable).all();
  }

  function stepRow(s: TestServer, id: string) {
    return s.db.select().from(stepTable).where(eq(stepTable.id, id)).get();
  }

  function credentialsOf(s: TestServer, machineId: string, stepId: string) {
    const machineToken = `machine-${stepId}`;
    s.db
      .update(machineTable)
      .set({ tokenHash: createHash('sha256').update(machineToken).digest('hex') })
      .where(eq(machineTable.id, machineId))
      .run();
    return s.app.request(`/api/machine/token/${stepId}`, {
      headers: { authorization: `Bearer ${machineToken}` },
    });
  }

  test('the first token is enabled, a token saved beside a live one is not', async () => {
    const { s } = await world();
    const first = await save(s, 'First', 'a');
    const second = await save(s, 'Second', 'b');
    expect(rows(s).find((row) => row.id === first)?.enabledAt).not.toBeNull();
    expect(rows(s).find((row) => row.id === second)?.enabledAt).toBeNull();
  });

  test('an expired enabled token is replaced by the next one saved, which is enabled', async () => {
    const { s } = await world();
    const old = await save(s, 'Old', 'a', Date.now() + 60_000);
    s.db
      .update(claudeSubscriptionTable)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(claudeSubscriptionTable.id, old))
      .run();
    expect(hasActiveClaudeSubscription({ db: s.db }, s.team.id)).toBe(false);
    const fresh = await save(s, 'Fresh', 'b');
    expect(rows(s).find((row) => row.id === old)?.enabledAt).toBeNull();
    expect(rows(s).find((row) => row.id === fresh)?.enabledAt).not.toBeNull();
    expect(hasActiveClaudeSubscription({ db: s.db }, s.team.id)).toBe(true);
  });

  test('the database refuses a second enabled row in a team but allows one per team', async () => {
    const { s } = await world();
    const first = await save(s, 'First', 'a');
    const second = await save(s, 'Second', 'b');
    expect(() =>
      s.db
        .update(claudeSubscriptionTable)
        .set({ enabledAt: 5 })
        .where(eq(claudeSubscriptionTable.id, second))
        .run(),
    ).toThrow(/UNIQUE/i);
    s.db
      .update(claudeSubscriptionTable)
      .set({ enabledAt: null })
      .where(eq(claudeSubscriptionTable.id, first))
      .run();
    expect(hasActiveClaudeSubscription({ db: s.db }, s.team.id)).toBe(false);
  });

  test.each(['build', 'chief'] as const)(
    'a %s claim is bound to the enabled account and keeps its token after the enabled row changes',
    async (kind) => {
      const { s, projectId } = await world();
      const machineId = insertMachine(s, {
        name: `bound-${kind}`,
        claudeCodeReport: report({ state: 'expired', expiresAt: 1 }),
      });
      const first = await save(s, 'First', 'a');
      const second = await save(s, 'Second', 'b');
      const stepId =
        kind === 'chief'
          ? insertChief(s, machineId, 'claude-code')
          : (() => {
              routeSession(s, { machineId, provider: 'claude-code' });
              return insertBuildStep(s, projectId);
            })();
      expect((await claimAs(s, machineId))?.step.id).toBe(stepId);
      expect(stepRow(s, stepId)?.claudeSubscriptionId).toBe(first);
      s.db
        .update(claudeSubscriptionTable)
        .set({ enabledAt: null })
        .where(eq(claudeSubscriptionTable.id, first))
        .run();
      s.db
        .update(claudeSubscriptionTable)
        .set({ enabledAt: Date.now() })
        .where(eq(claudeSubscriptionTable.id, second))
        .run();
      const response = await credentialsOf(s, machineId, stepId);
      expect(await response.json()).toMatchObject({ claudeSubscriptionToken: tokenOf('a') });
    },
  );

  test('a step with no recorded account receives no stored token even when one is enabled', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, { name: 'unbound', claudeCodeReport: report() });
    routeSession(s, { machineId, provider: 'claude-code' });
    const stepId = insertBuildStep(s, projectId);
    s.db
      .update(stepTable)
      .set({ machineId, status: 'claimed' })
      .where(eq(stepTable.id, stepId))
      .run();
    expect(stepRow(s, stepId)?.claudeSubscriptionId).toBeNull();
    await save(s, 'Late', 'a');
    const response = await credentialsOf(s, machineId, stepId);
    expect(await response.text()).not.toContain(tokenOf('a'));
  });

  test('a step whose bound account is gone receives nothing and never another account', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, { name: 'gone', claudeCodeReport: report() });
    const first = await save(s, 'First', 'a');
    await save(s, 'Second', 'b');
    routeSession(s, { machineId, provider: 'claude-code' });
    const stepId = insertBuildStep(s, projectId);
    expect((await claimAs(s, machineId))?.step.id).toBe(stepId);
    expect(stepRow(s, stepId)?.claudeSubscriptionId).toBe(first);
    s.db.delete(claudeSubscriptionTable).where(eq(claudeSubscriptionTable.id, first)).run();
    const body = await (await credentialsOf(s, machineId, stepId)).text();
    expect(body).not.toContain(tokenOf('a'));
    expect(body).not.toContain(tokenOf('b'));
  });

  test('the in-server Coordinator claim never records an account', async () => {
    const { s } = await world();
    await save(s, 'First', 'a');
    const machineId = insertMachine(s, { name: 'unused', claudeCodeReport: report() });
    const stepId = insertChief(s, machineId, 'claude-code');
    const pending = stepRow(s, stepId);
    expect(pending).toBeDefined();
    expect(claimPendingChiefStep(s.db, pending as NonNullable<typeof pending>, null)).toBe(true);
    expect(stepRow(s, stepId)).toMatchObject({ status: 'claimed', claudeSubscriptionId: null });
  });

  test('a step on a runtime other than Claude Code records no account', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, { name: 'pi-runtime', claudeCodeReport: report() });
    await save(s, 'First', 'a');
    routeSession(s, { machineId, provider: 'stub-gw' });
    const stepId = insertBuildStep(s, projectId);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe(stepId);
    expect(stepRow(s, stepId)?.claudeSubscriptionId).toBeNull();
  });

  test('the migration backfill enables the newest unexpired row per team and binds claimed steps', async () => {
    const { s } = await world();
    const machineId = insertMachine(s, { name: 'backfill', claudeCodeReport: report() });
    const base = { teamId: s.team.id, tokenCipher: 'cipher', expiresAt: null, enabledAt: null };
    s.db
      .insert(claudeSubscriptionTable)
      .values([
        { ...base, id: 'old', label: 'old', createdAt: 1 },
        { ...base, id: 'new', label: 'new', createdAt: 2 },
        { ...base, id: 'dead', label: 'dead', createdAt: 3, expiresAt: 1 },
      ])
      .run();
    s.db
      .insert(stepTable)
      .values([
        { id: 'running', buildId: 'b1', kind: 'build', status: 'claimed', machineId, createdAt: 1 },
        { id: 'queued', buildId: 'b2', kind: 'build', status: 'pending', createdAt: 2 },
      ])
      .run();
    const statements = readFileSync(
      new URL('../drizzle/0170_claude_subscription_enabled.sql', import.meta.url),
      'utf8',
    )
      .split('--> statement-breakpoint')
      .filter((statement) => /^\s*UPDATE/i.test(statement));
    expect(statements).toHaveLength(2);
    for (const statement of statements) s.db.run(sql.raw(statement));
    expect(
      rows(s)
        .filter((row) => row.enabledAt !== null)
        .map((row) => row.id),
    ).toEqual(['new']);
    expect(stepRow(s, 'running')?.claudeSubscriptionId).toBe('new');
    expect(stepRow(s, 'queued')?.claudeSubscriptionId).toBeNull();
  });
});
