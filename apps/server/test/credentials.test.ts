import { createHash } from 'node:crypto';
import type { GitIdentity } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { machine as machineTable, routingRule, step as stepTable } from '../src/db/schema.js';
import { createEphemeralSecretBox, SecretBoxError } from '../src/lib/secret-box.js';
import { startBuilds } from '../src/services/builds.js';
import { resolveStepCredentials } from '../src/services/credentials.js';
import { stepToken } from '../src/services/machine-step-token.js';
import { createProvider } from '../src/services/providers.js';
import { createSecret } from '../src/services/secrets.js';
import {
  bootServer,
  insertMachine,
  postProject,
  req,
  seedPolicy,
  seedRoute,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

const RELAY_KEY = 'sk-relay-per-step';
const STRIPE_VALUE = 'sk_live_stripe';

function setSessionProvider(s: TestServer, provider: string): void {
  s.db
    .update(routingRule)
    .set({ provider })
    .where(and(eq(routingRule.teamId, s.team.id), eq(routingRule.use, 'session')))
    .run();
}

async function withRoutedStack(
  opts: { secretsGranted?: boolean; githubAppIdentity?: GitIdentity } = {},
) {
  const s = bootServer(
    opts.githubAppIdentity === undefined ? {} : { githubAppIdentity: opts.githubAppIdentity },
  );
  const keysvc = { db: s.db, box: s.secretBox };
  createProvider(keysvc, {
    teamId: s.team.id,
    body: {
      providerId: 'r3-gw',
      label: 'r3 网关',
      baseUrl: 'https://api.example.com/v1',
      api: 'anthropic-messages',
      apiKey: RELAY_KEY,
      models: [{ id: 'claude-sonnet-5', name: 'claude-sonnet-5' }],
    },
    createdBy: s.user.id,
  });
  const secret = createSecret(keysvc, {
    teamId: s.team.id,
    name: 'STRIPE_API_KEY',
    description: null,
    value: STRIPE_VALUE,
  });
  seedSessionRoute(s, {
    provider: 'r3-gw',
    modelId: 'claude-sonnet-5',
    secrets: opts.secretsGranted === false ? [] : [secret.id],
  });
  const projectId = await postProject(s.app);
  const todoDoc = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: '跑任务', spec: '' })
  ).json()) as { id: string };
  insertMachine(s);
  const builds = startBuilds(
    { db: s.db, hub: s.hub, user: s.user },
    {
      projectId,
      todoIds: [todoDoc.id],
    },
  );
  const buildId = builds[0]?.id;
  if (!buildId) throw new Error('no build');
  const stepRow = s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all()[0];
  if (!stepRow) throw new Error('no step');
  return { ...s, keysvc, stepId: stepRow.id, buildId, todoId: todoDoc.id, projectId };
}

function addStep(
  s: { db: ReturnType<typeof bootServer>['db'] },
  buildId: string,
  kind: 'build' | 'merge' | 'review' | 'chief',
  prompt: string | null = null,
): string {
  const id = `step-${kind}`;
  s.db
    .insert(stepTable)
    .values({
      id,
      buildId,
      kind,
      machineId: null,
      status: 'pending',
      prompt,
      createdAt: Date.now(),
    })
    .run();
  return id;
}

describe('resolveStepCredentials (per-step dispatch interface surface)', () => {
  test('execution step full-chain resolution: provider plaintext + secrets access surface + git null slot', async () => {
    const s = await withRoutedStack();
    const buildStepId = addStep(s, s.buildId, 'build');
    const bundle = resolveStepCredentials(s.keysvc, buildStepId);
    expect(bundle.provider).toMatchObject({
      providerId: 'r3-gw',
      baseUrl: 'https://api.example.com/v1',
      api: 'anthropic-messages',
      authHeader: true,
      apiKey: RELAY_KEY,
      modelId: 'claude-sonnet-5',
    });
    expect(bundle.secrets).toEqual({ STRIPE_API_KEY: STRIPE_VALUE });
    expect(bundle.git).toBeNull();
  });

  test('per-step narrowing: review / chief-exploration step access surfaces are always empty', async () => {
    const s = await withRoutedStack();
    expect(resolveStepCredentials(s.keysvc, s.stepId).secrets).toEqual({
      STRIPE_API_KEY: STRIPE_VALUE,
    });
    expect(resolveStepCredentials(s.keysvc, addStep(s, s.buildId, 'review')).secrets).toEqual({});
    expect(resolveStepCredentials(s.keysvc, addStep(s, s.buildId, 'chief')).secrets).toEqual({});
    expect(resolveStepCredentials(s.keysvc, addStep(s, s.buildId, 'build')).secrets).toEqual({
      STRIPE_API_KEY: STRIPE_VALUE,
    });
  });

  test('secrets switch not granted = empty access surface (session work policy grant)', async () => {
    const s = await withRoutedStack({ secretsGranted: false });
    const bundle = resolveStepCredentials(s.keysvc, addStep(s, s.buildId, 'build'));
    expect(bundle.secrets).toEqual({});
    expect(bundle.provider?.apiKey).toBe(RELAY_KEY);
  });

  test('claimed follow-up steps open newly granted session policy secrets', async () => {
    const s = await withRoutedStack({ secretsGranted: false });
    const secret = createSecret(s.keysvc, {
      teamId: s.team.id,
      name: 'FOLLOWUP_SECRET',
      description: null,
      value: 'followup-secret-value',
    });
    seedPolicy(s, 'session', { secrets: [secret.id] });
    const machineId = insertMachine(s, { name: 'followup-secrets' });
    const stepId = addStep(s, s.buildId, 'build');
    s.db
      .update(stepTable)
      .set({ status: 'claimed', machineId })
      .where(eq(stepTable.id, stepId))
      .run();
    const bundle = await stepToken(
      {
        ...s.svc,
        box: s.secretBox,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
      },
      machineId,
      stepId,
    );
    expect(bundle.secrets).toEqual({ FOLLOWUP_SECRET: 'followup-secret-value' });
    expect(bundle.provider).toMatchObject({ apiKey: RELAY_KEY });
    s.dispose();
  });

  test('no session routing rule = provider null + empty access surface; unknown step 404', async () => {
    const s = await withRoutedStack();
    s.db.delete(routingRule).where(eq(routingRule.teamId, s.team.id)).run();
    const second = (await (
      await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, { title: '裸跑', spec: '' })
    ).json()) as { id: string };
    const builds = startBuilds(
      { db: s.db, hub: s.hub, user: s.user },
      {
        projectId: s.projectId,
        todoIds: [second.id],
      },
    );
    const stepRow = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, builds[0]?.id ?? ''))
      .all()[0];
    const bundle = resolveStepCredentials(s.keysvc, stepRow?.id ?? '');
    expect(bundle.provider).toBeNull();
    expect(bundle.secrets).toEqual({});

    expect(() => resolveStepCredentials(s.keysvc, 'nope')).toThrowError(/not found/);
  });

  test('keyfile lost (box swapped) -> SecretBoxError = legacy-scrap cutover (02 section 8 guardrail)', async () => {
    const s = await withRoutedStack();
    const buildStepId = addStep(s, s.buildId, 'build');
    const orphaned = { db: s.db, box: createEphemeralSecretBox() };
    expect(() => resolveStepCredentials(orphaned, buildStepId)).toThrow(SecretBoxError);
  });
});

describe('subscription credential dispatch', () => {
  test('only Claude Code steps receive the newest unexpired team subscription', async () => {
    const s = await withRoutedStack();
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    const token =
      'sk-ant-oat01-private-subscription-for-credential-test-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
    const saved = await req(s.app, 'POST', path, { label: 'Personal', token });
    expect(saved.status).toBe(201);
    const buildStep = addStep(s, s.buildId, 'build');
    expect(resolveStepCredentials(s.keysvc, buildStep).claudeSubscriptionToken).toBeUndefined();
    setSessionProvider(s, 'claude-code');
    expect(resolveStepCredentials(s.keysvc, buildStep).claudeSubscriptionToken).toBe(token);
    expect(resolveStepCredentials(s.keysvc, buildStep).secrets).not.toHaveProperty(
      'CLAUDE_CODE_OAUTH_TOKEN',
    );
    await req(s.app, 'POST', path, {
      label: 'Expired',
      token:
        'sk-ant-oat01-expired-token-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
      expiresAt: 1,
    });
    expect(resolveStepCredentials(s.keysvc, buildStep).claudeSubscriptionToken).toBe(token);
    await req(s.app, 'POST', path, {
      label: 'Replacement',
      token:
        'sk-ant-oat01-replacement-token-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
    });
    expect(resolveStepCredentials(s.keysvc, buildStep).claudeSubscriptionToken).toBe(
      'sk-ant-oat01-replacement-token-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
    );
  });
});

test('a review route on a pi provider cannot receive the session subscription', async () => {
  const s = await withRoutedStack();
  await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions`, {
    label: 'Personal',
    token:
      'sk-ant-oat01-private-planning-test-token-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
  });
  setSessionProvider(s, 'claude-code');
  seedRoute(s, 'review', { provider: 'r3-gw', modelId: 'stub-model' });
  expect(resolveStepCredentials(s.keysvc, s.stepId).claudeSubscriptionToken).toBeDefined();
  const reviewStep = addStep(s, s.buildId, 'review');
  expect(resolveStepCredentials(s.keysvc, reviewStep).claudeSubscriptionToken).toBeUndefined();
});

test('finished steps retain provider-key responses', async () => {
  const s = await withRoutedStack();
  const machineId = insertMachine(s, { name: 'finished-provider' });
  const stepId = addStep(s, s.buildId, 'build');
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
  for (const status of ['claimed', 'done'] as const) {
    s.db.update(stepTable).set({ machineId, status }).where(eq(stepTable.id, stepId)).run();
    expect((await stepToken(deps, machineId, stepId)).provider).toMatchObject({
      apiKey: RELAY_KEY,
    });
  }
});

test('a step commits as the configured App bot user from configuration, and as nobody in particular without one', async () => {
  const s = await withRoutedStack();
  const machineId = insertMachine(s, { name: 'identity' });
  const stepId = addStep(s, s.buildId, 'build');
  s.db
    .update(stepTable)
    .set({ machineId, status: 'claimed' })
    .where(eq(stepTable.id, stepId))
    .run();
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
  expect((await stepToken(deps, machineId, stepId)).commitIdentity).toBeNull();
  const bot = {
    name: 'cairnwright[bot]',
    email: '347615582+cairnwright[bot]@users.noreply.github.com',
  };
  expect(
    (
      await stepToken(
        { ...deps, githubAppTokenSocket: null, githubAppIdentity: bot },
        machineId,
        stepId,
      )
    ).commitIdentity,
  ).toEqual(bot);
});

test('the machine token route hands the configured App identity to a first claim and to a retry', async () => {
  const bot = {
    name: 'cairnwright[bot]',
    email: '347615582+cairnwright[bot]@users.noreply.github.com',
  };
  const s = await withRoutedStack({ githubAppIdentity: bot });
  const machineId = insertMachine(s, { name: 'route-identity' });
  const machineToken = 'route-identity-machine-auth';
  s.db
    .update(machineTable)
    .set({ tokenHash: createHash('sha256').update(machineToken).digest('hex') })
    .where(eq(machineTable.id, machineId))
    .run();
  const headers = { authorization: `Bearer ${machineToken}` };
  s.db
    .update(stepTable)
    .set({ machineId, status: 'claimed' })
    .where(eq(stepTable.id, s.stepId))
    .run();
  const first = await s.app.request(`/api/machine/token/${s.stepId}`, { headers });
  expect(first.status).toBe(200);
  expect(((await first.json()) as { commitIdentity: unknown }).commitIdentity).toEqual(bot);
  s.db.update(stepTable).set({ status: 'failed' }).where(eq(stepTable.id, s.stepId)).run();
  const retry = addStep(s, s.buildId, 'build');
  s.db.update(stepTable).set({ machineId, status: 'claimed' }).where(eq(stepTable.id, retry)).run();
  const retried = await s.app.request(`/api/machine/token/${retry}`, { headers });
  expect(retried.status).toBe(200);
  expect(((await retried.json()) as { commitIdentity: unknown }).commitIdentity).toEqual(bot);
});

describe('resolveStepCredentials routing', () => {
  test('a session rule picks the provider key for build steps; secrets stay the policy grant', async () => {
    const s = await withRoutedStack();
    createProvider(s.keysvc, {
      teamId: s.team.id,
      body: {
        providerId: 'routed-gw',
        label: 'routed',
        baseUrl: 'https://routed.example.com/v1',
        api: 'anthropic-messages',
        apiKey: 'sk-routed',
        models: [{ id: 'routed-model', name: 'routed-model' }],
      },
      createdBy: s.user.id,
    });
    s.db
      .update(routingRule)
      .set({ provider: 'routed-gw', modelId: 'routed-model' })
      .where(and(eq(routingRule.teamId, s.team.id), eq(routingRule.use, 'session')))
      .run();
    seedRoute(s, 'review', { provider: 'r3-gw', modelId: 'claude-sonnet-5' });
    const buildStepId = addStep(s, s.buildId, 'build');
    const routed = resolveStepCredentials(s.keysvc, buildStepId);
    expect(routed.provider).toMatchObject({
      providerId: 'routed-gw',
      baseUrl: 'https://routed.example.com/v1',
      apiKey: 'sk-routed',
      modelId: 'routed-model',
    });
    expect(routed.secrets).toEqual({ STRIPE_API_KEY: STRIPE_VALUE });
    expect(
      resolveStepCredentials(s.keysvc, addStep(s, s.buildId, 'review')).provider,
    ).toMatchObject({ providerId: 'r3-gw', apiKey: RELAY_KEY });
  });

  test('a session work policy that names no secrets opens none, whatever the rule row carries', async () => {
    const s = await withRoutedStack();
    s.db
      .update(routingRule)
      .set({ secrets: ['STRIPE_API_KEY'] })
      .where(and(eq(routingRule.teamId, s.team.id), eq(routingRule.use, 'session')))
      .run();
    seedPolicy(s, 'session', { secrets: [] });
    expect(resolveStepCredentials(s.keysvc, addStep(s, s.buildId, 'build')).secrets).toEqual({});
  });
});
