import type { RoutingConnection, RoutingEdge, RoutingQuota } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import {
  agent,
  build,
  chief,
  chiefThread,
  machine,
  project,
  step,
  team,
  todo,
} from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { claimStep } from '../src/services/machine-claim.js';
import { createProvider } from '../src/services/providers.js';
import { sweepQuotaWaitSteps } from '../src/services/quota-wait.js';
import { bootServer, insertMachine, req } from './helpers.js';

test('routing endpoint returns all uses, unavailable edges, stored windows and no credentials', async () => {
  const s = bootServer();
  const path = `/api/teams/${s.team.id}/model-routing`;
  const empty = await req(s.app, 'GET', path);
  expect(empty.status).toBe(200);
  const initial = (await empty.json()) as { edges: RoutingEdge[] };
  expect(initial.edges.map((edge) => edge.use)).toEqual([
    'coordinator',
    'implementation',
    'review',
    'mechanical',
    'eval',
    'nightly-scan',
  ]);
  expect(initial.edges.every((edge) => edge.unavailable === true)).toBe(true);
  const id = insertMachine(s, {
    claudeCodeReport: {
      installed: true,
      hostname: 'test',
      models: [{ id: 'claude-opus-5-5', name: 'Opus' }],
      auth: { state: 'logged-in', method: 'oauth' },
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
        {
          subscription: 'seven_day',
          status: 'allowed',
          utilization: 0.6,
          resetsAt: Date.now() + 100000,
          reportedAt: Date.now(),
        },
      ],
    })
    .where(eq(machine.id, id))
    .run();
  const body = (await (await req(s.app, 'GET', path)).json()) as {
    edges: RoutingEdge[];
    connections: RoutingConnection[];
    quota: RoutingQuota[];
  };
  expect(body.edges[0]).toMatchObject({ connectionId: `machine:${id}` });
  expect(body.quota).toMatchObject([
    {
      connectionId: `machine:${id}`,
      windows: [
        { window: '5h', usedPercent: 40 },
        { window: 'week', usedPercent: 60 },
      ],
    },
  ]);
  expect(JSON.stringify(body)).not.toMatch(/Cipher|apiKey|tokenHash/);
  expect((await req(s.app, 'GET', '/api/teams/other/model-routing')).status).toBe(404);
});

test('Claude usage defaults safely, persists through reseeding and rejects invalid settings', async () => {
  const s = bootServer();
  expect(seed(s.db).team).toMatchObject({ claudeUsage: 'subscription-only' });
  const path = `/api/teams/${s.team.id}`;
  expect((await req(s.app, 'PATCH', path, { claudeUsage: 'invalid' })).status).toBe(400);
  expect((await req(s.app, 'PATCH', path, { claudeUsage: 'allow-paid' })).status).toBe(200);
  expect(seed(s.db).team).toMatchObject({ claudeUsage: 'allow-paid' });
  expect(await (await req(s.app, 'GET', '/api/teams')).json()).toMatchObject([
    { claudeUsage: 'allow-paid' },
  ]);
  expect(
    (await req(s.app, 'PATCH', '/api/teams/other', { claudeUsage: 'allow-paid' })).status,
  ).toBe(404);
});

test.each([
  { triggerSource: 'user', mode: 'direct' },
  { triggerSource: 'schedule', mode: 'direct' },
  { triggerSource: 'user', mode: 'fallback' },
  { triggerSource: 'user', mode: 'native' },
  { triggerSource: 'user', mode: 'takeover' },
] as const)(
  '$triggerSource $mode paid Claude step parks before claim and resumes only after opt-in',
  async ({ triggerSource, mode }) => {
    const s = bootServer();
    const mid = insertMachine(
      s,
      mode === 'native' || mode === 'takeover'
        ? {
            claudeCodeReport: {
              installed: true,
              hostname: 'test',
              models: [{ id: 'claude-sonnet-5-5', name: 'Sonnet' }],
              auth: { state: 'logged-in', method: mode === 'takeover' ? 'oauth' : 'api_key' },
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
    s.db
      .insert(agent)
      .values({
        id: 'worker',
        teamId: s.team.id,
        displayName: 'Worker',
        provider:
          mode === 'native' || mode === 'takeover'
            ? 'claude-code'
            : mode === 'fallback'
              ? 'openai'
              : 'anthropic',
        modelId: mode === 'fallback' ? 'gpt-6.1-sol' : 'claude-sonnet-5-5',
        machineId: mid,
      })
      .run();
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
        assignment: { plan: null, build: { agentId: 'worker' } },
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
        agentId: 'worker',
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
    expect(await claimStep(deps, claimant, s.team.id, 0, 'http://localhost')).toBeNull();
    expect(s.db.select().from(step).where(eq(step.id, 'pending')).get()).toMatchObject({
      status: 'waiting_quota',
      machineId: null,
      quotaBlock: { reason: 'subscription-only' },
    });
    expect(s.db.select().from(step).where(eq(step.id, 'coordinator-step')).get()).toMatchObject({
      status: 'waiting_quota',
      quotaBlock: { reason: 'subscription-only' },
    });
    expect(s.db.select().from(step).where(eq(step.id, 'running')).get()).toMatchObject({
      status: 'claimed',
      machineId: mid,
      fallback: null,
    });
    sweepQuotaWaitSteps(s.svc, Date.now() + 30 * 24 * 60 * 60 * 1000);
    expect(s.db.select().from(step).where(eq(step.id, 'pending')).get()?.status).toBe(
      'waiting_quota',
    );
    await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, { claudeUsage: 'allow-paid' });
    expect(await claimStep(deps, claimant, s.team.id, 0, 'http://localhost')).toMatchObject({
      step: { id: 'pending' },
      agent: { provider: mode === 'native' || mode === 'takeover' ? 'claude-code' : 'anthropic' },
    });
    expect(s.db.select().from(team).get()).toMatchObject({ claudeUsage: 'allow-paid' });
  },
);

test('known quota stays visible while a machine model report is missing', async () => {
  const s = bootServer();
  const id = insertMachine(s);
  s.db
    .update(machine)
    .set({
      claudeRateLimits: [
        {
          subscription: 'five_hour',
          status: 'rejected',
          utilization: null,
          resetsAt: null,
          reportedAt: 1,
        },
      ],
    })
    .where(eq(machine.id, id))
    .run();
  const body = (await (
    await req(s.app, 'GET', `/api/teams/${s.team.id}/model-routing`)
  ).json()) as { edges: RoutingEdge[]; quota: RoutingQuota[] };
  expect(body.quota).toEqual([
    {
      connectionId: `machine:${id}`,
      windows: [{ window: '5h', usedPercent: null, resetsAt: null, reportedAt: 1 }],
    },
  ]);
  expect(body.edges.every((edge) => edge.unavailable === true)).toBe(true);
});
