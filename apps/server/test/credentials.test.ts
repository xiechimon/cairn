import { createHash, generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { claimedStepSchema, GITHUB_REPOSITORY_RENAMED, type GitIdentity } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { startMint } from '../../../ops/app-token-mint/mint.mjs';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  claudeSubscription,
  machine as machineTable,
  provider as providerTable,
  routingRule,
  step as stepTable,
} from '../src/db/schema.js';
import { createEphemeralSecretBox, SecretBoxError } from '../src/lib/secret-box.js';
import { startBuilds } from '../src/services/builds.js';
import { resolveStepCredentials } from '../src/services/credentials.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { stepToken } from '../src/services/machine-step-token.js';
import { createProvider } from '../src/services/providers.js';
import { createSecret } from '../src/services/secrets.js';
import { writeSubscription } from '../src/services/step-groups/subscription.js';
import {
  bootServer,
  insertMachine,
  postProject,
  req,
  seedPolicy,
  seedRoute,
  seedSessionRoute,
  startLegacyBuild,
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
  if (provider === 'claude-code') {
    s.db
      .update(machineTable)
      .set({
        claudeCodeReport: {
          installed: true,
          hostname: 'test',
          models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5' }],
          auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
        },
      })
      .where(eq(machineTable.teamId, s.team.id))
      .run();
  }
}

async function withRoutedStack(
  opts: {
    secretsGranted?: boolean;
    githubAppIdentity?: GitIdentity;
    githubAppTokenSocket?: string;
  } = {},
) {
  const s = bootServer({
    ...(opts.githubAppIdentity === undefined ? {} : { githubAppIdentity: opts.githubAppIdentity }),
    ...(opts.githubAppTokenSocket === undefined
      ? {}
      : { githubAppTokenSocket: opts.githubAppTokenSocket }),
  });
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
    const generation = Date.now();
    s.db
      .update(stepTable)
      .set({ status: 'claimed', machineId, claimedAt: generation })
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
      generation,
    );
    expect(bundle.secrets).toEqual({ FOLLOWUP_SECRET: 'followup-secret-value' });
    expect(bundle.provider).toMatchObject({ apiKey: RELAY_KEY });
    s.dispose();
  });

  test('no session routing rule and no provider = provider null + empty access surface; unknown step 404', async () => {
    const s = await withRoutedStack();
    s.db.delete(routingRule).where(eq(routingRule.teamId, s.team.id)).run();
    s.db.delete(providerTable).where(eq(providerTable.teamId, s.team.id)).run();
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
  test('only Claude Code steps receive the subscription they were claimed with', async () => {
    const s = await withRoutedStack();
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    const token =
      'sk-ant-oat01-private-subscription-for-credential-test-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
    const saved = await req(s.app, 'POST', path, { label: 'Personal', token });
    expect(saved.status).toBe(201);
    const buildStep = addStep(s, s.buildId, 'build');
    s.db.transaction((tx) =>
      writeSubscription(tx, buildStep, {
        claudeSubscriptionId: tx.select().from(claudeSubscription).get()?.id ?? null,
      }),
    );
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
    expect(resolveStepCredentials(s.keysvc, buildStep).claudeSubscriptionToken).toBe(token);
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
  const enabledId = s.db.select().from(claudeSubscription).get()?.id ?? null;
  s.db.transaction((tx) => {
    for (const row of tx.select({ id: stepTable.id }).from(stepTable).all()) {
      writeSubscription(tx, row.id, { claudeSubscriptionId: enabledId });
    }
  });
  expect(resolveStepCredentials(s.keysvc, s.stepId).claudeSubscriptionToken).toBeDefined();
  const reviewStep = addStep(s, s.buildId, 'review');
  expect(resolveStepCredentials(s.keysvc, reviewStep).claudeSubscriptionToken).toBeUndefined();
});

test('only a live claim receives provider-key responses; a finished step is refused', async () => {
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
  const generation = Date.now();
  s.db
    .update(stepTable)
    .set({ machineId, status: 'claimed', claimedAt: generation })
    .where(eq(stepTable.id, stepId))
    .run();
  expect((await stepToken(deps, machineId, stepId, generation)).provider).toMatchObject({
    apiKey: RELAY_KEY,
  });
  s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, stepId)).run();
  await expect(stepToken(deps, machineId, stepId, generation)).rejects.toMatchObject({
    status: 409,
  });
});

test('a stale-generation claim is refused before any credential work runs', async () => {
  const s = await withRoutedStack();
  const machineId = insertMachine(s, { name: 'stale-generation' });
  const stepId = addStep(s, s.buildId, 'build');
  s.db
    .update(stepTable)
    .set({ machineId, status: 'claimed', claimedAt: 33, claimedRepo: 'octo/alpha' })
    .where(eq(stepTable.id, stepId))
    .run();
  const mintCalls: string[] = [];
  const mint = createServer((req, res) => {
    mintCalls.push(req.url ?? '');
    res.statusCode = 500;
    res.end();
  });
  const socketPath = join(s.reposDir, 'mint.sock');
  await new Promise<void>((resolve) => mint.listen(socketPath, resolve));
  try {
    const deps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
      githubAppTokenSocket: socketPath,
    };
    await expect(stepToken(deps, machineId, stepId, 22)).rejects.toMatchObject({
      status: 409,
      reason: 'claim-moved',
    });
    expect(mintCalls).toEqual([]);
  } finally {
    await new Promise((resolve) => mint.close(resolve));
  }
});

test('concurrent and sequential token fetches share one mint exchange; a flagged refresh forces once', async () => {
  const dir = makeTestTempDir('app-provider-');
  const socketPath = join(dir, 'mint.sock');
  const s = await withRoutedStack({ githubAppTokenSocket: socketPath });
  const machineId = insertMachine(s, { name: 'coalesced-fetch' });
  const stepId = addStep(s, s.buildId, 'build');
  const generation = Date.now();
  s.db
    .update(stepTable)
    .set({
      machineId,
      status: 'claimed',
      claimedAt: generation,
      claimedRepo: 'octo/alpha',
      claimedRepoId: 4242,
    })
    .where(eq(stepTable.id, stepId))
    .run();
  const mintCalls: { url: string; refresh: string | undefined }[] = [];
  const mint = createServer((req, res) => {
    mintCalls.push({ url: req.url ?? '', refresh: req.headers['x-cairn-refresh'] as string });
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        token: `app-${mintCalls.length}`,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        installationId: 456,
        appSlug: 'cairnwright',
        repositories: [`${params.get('owner')}/${params.get('repository')}`.toLowerCase()],
        ...(params.get('repository_id') === null
          ? {}
          : { repositoryId: Number(params.get('repository_id')) }),
        permissions: Object.fromEntries(
          (params.get('permissions') ?? '')
            .split(',')
            .filter((entry) => entry.includes(':'))
            .map((entry) => entry.split(':') as [string, string]),
        ),
      }),
    );
  });
  await new Promise<void>((resolve) => mint.listen(socketPath, resolve));
  try {
    const deps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
      githubAppTokenSocket: socketPath,
    };
    const results = await Promise.all([
      stepToken(deps, machineId, stepId, generation),
      stepToken(deps, machineId, stepId, generation),
      stepToken(deps, machineId, stepId, generation),
    ]);
    expect(results.every((r) => r.git?.kind === 'app')).toBe(true);
    expect(mintCalls.map((call) => call.refresh)).toEqual([undefined]);
    const machineToken = 'coalesced-fetch-auth';
    s.db
      .update(machineTable)
      .set({ tokenHash: createHash('sha256').update(machineToken).digest('hex') })
      .where(eq(machineTable.id, machineId))
      .run();
    const path = `/api/machine/token/${stepId}?generation=${generation}`;
    const headers = { authorization: `Bearer ${machineToken}` };
    const ordinary = await s.app.request(path, { headers });
    expect(ordinary.status).toBe(200);
    expect(await ordinary.json()).toMatchObject({ git: { kind: 'app', password: 'app-1' } });
    expect(mintCalls.map((call) => call.refresh)).toEqual([undefined]);

    const refreshed = await s.app.request(`${path}&refresh=1`, { headers });
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toMatchObject({ git: { kind: 'app', password: 'app-2' } });
    const afterRefresh = await s.app.request(path, { headers });
    expect(afterRefresh.status).toBe(200);
    expect(await afterRefresh.json()).toMatchObject({ git: { kind: 'app', password: 'app-2' } });
    expect(mintCalls.map((call) => call.refresh)).toEqual([undefined, '1']);
    expect(mintCalls.every((call) => call.url.includes('repository=alpha'))).toBe(true);
  } finally {
    await new Promise((resolve) => mint.close(resolve));
    await releaseTestTempDir(dir);
  }
});

test('reconnecting after a repository rename unblocks the next ordinary runner credential fetch', async ({
  onTestFinished,
}) => {
  const dir = makeTestTempDir('app-provider-');
  const socketPath = join(dir, 'mint.sock');
  const privateKeyPath = join(dir, 'key.pem');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
  });
  let fullName = 'octo/alpha';
  const repositoryId = 4242;
  let runnerExchanges = 0;
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  const mint = await startMint(
    { appId: '123', installationId: 456, privateKeyPath, socketPath },
    {
      fetchImpl: async (url, init) => {
        if (String(url).endsWith('/app')) return Response.json({ slug: 'cairnwright' });
        if (typeof init?.body !== 'string') throw new Error('expected a mint request body');
        const { repository_ids, permissions } = JSON.parse(init.body) as {
          repository_ids?: number[];
          permissions: Record<string, string>;
        };
        if (repository_ids !== undefined) expect(repository_ids).toEqual([repositoryId]);
        return Response.json({
          token: repository_ids === undefined ? 'app-read' : `app-runner-${++runnerExchanges}`,
          expires_at: expiresAt,
          repositories: [{ id: repositoryId, full_name: fullName }],
          permissions,
        });
      },
    },
  );
  onTestFinished(() => new Promise<void>((resolve) => mint.close(() => resolve())));
  const s = bootServer({
    claimHoldMs: 100,
    githubAppTokenSocket: socketPath,
    githubFetch: async () => Response.json({ id: repositoryId, full_name: fullName }),
  });
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      login: 'octo',
      githubUserId: 12,
      githubName: 'Octo',
      accessToken: 'fixture-oauth-token',
      scope: 'repo',
    },
  );
  const created = await req(s.app, 'POST', '/api/projects', {
    name: 'rename-reconnect',
    kind: 'github',
    githubRepo: fullName,
  });
  expect(created.status).toBe(201);
  const { id: projectId } = (await created.json()) as { id: string };
  const machineId = insertMachine(s, { name: 'rename-reconnect' });
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'm', machineId });
  const machineToken = 'rename-reconnect-auth';
  s.db
    .update(machineTable)
    .set({ tokenHash: createHash('sha256').update(machineToken).digest('hex') })
    .where(eq(machineTable.id, machineId))
    .run();
  const headers = { authorization: `Bearer ${machineToken}`, 'content-type': 'application/json' };
  const claim = async (title: string) => {
    const todo = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title, spec: '' });
    expect(todo.status).toBe(201);
    const { id } = (await todo.json()) as { id: string };
    startLegacyBuild(s, id, { withPlan: true });
    const response = await s.app.request('/api/machine/tasks/claim', {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(response.status).toBe(200);
    const { step } = (await response.json()) as { step: unknown };
    return claimedStepSchema.parse(step).step;
  };
  const first = await claim('Before reconnecting');
  const firstPath = `/api/machine/token/${first.id}?generation=${first.generation}`;
  const warm = await s.app.request(firstPath, { headers });
  expect(warm.status).toBe(200);
  expect(await warm.json()).toMatchObject({ git: { kind: 'app', password: 'app-runner-1' } });

  fullName = 'octo/beta';
  const refused = await s.app.request(`${firstPath}&refresh=1`, { headers });
  expect(refused.status).toBe(503);
  expect(await refused.json()).toEqual({
    error: GITHUB_REPOSITORY_RENAMED.message,
    reason: GITHUB_REPOSITORY_RENAMED.reason,
  });
  expect(runnerExchanges).toBe(2);
  s.db.update(stepTable).set({ status: 'failed' }).where(eq(stepTable.id, first.id)).run();

  fullName = 'octo/gamma';
  const reconnected = await req(s.app, 'PATCH', `/api/projects/${projectId}`, {
    githubRepo: fullName,
  });
  expect(reconnected.status).toBe(200);
  expect(await reconnected.json()).toMatchObject({ githubRepo: fullName });
  const next = await claim('After reconnecting');
  const nextPath = `/api/machine/token/${next.id}?generation=${next.generation}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await s.app.request(nextPath, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ git: { kind: 'app', password: 'app-runner-3' } });
  }
  expect(runnerExchanges).toBe(3);
});

test('a step commits as the configured App bot user from configuration, and as nobody in particular without one', async () => {
  const s = await withRoutedStack();
  const machineId = insertMachine(s, { name: 'identity' });
  const stepId = addStep(s, s.buildId, 'build');
  const generation = Date.now();
  s.db
    .update(stepTable)
    .set({ machineId, status: 'claimed', claimedAt: generation })
    .where(eq(stepTable.id, stepId))
    .run();
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
  expect((await stepToken(deps, machineId, stepId, generation)).commitIdentity).toBeNull();
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
        generation,
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
    .set({ machineId, status: 'claimed', claimedAt: 11 })
    .where(eq(stepTable.id, s.stepId))
    .run();
  const first = await s.app.request(`/api/machine/token/${s.stepId}?generation=11`, { headers });
  expect(first.status).toBe(200);
  expect(((await first.json()) as { commitIdentity: unknown }).commitIdentity).toEqual(bot);
  s.db.update(stepTable).set({ status: 'failed' }).where(eq(stepTable.id, s.stepId)).run();
  const retry = addStep(s, s.buildId, 'build');
  s.db
    .update(stepTable)
    .set({ machineId, status: 'claimed', claimedAt: 22 })
    .where(eq(stepTable.id, retry))
    .run();
  const retried = await s.app.request(`/api/machine/token/${retry}?generation=22`, { headers });
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
    seedPolicy(s, 'session', { secrets: [] });
    expect(resolveStepCredentials(s.keysvc, addStep(s, s.buildId, 'build')).secrets).toEqual({});
  });
});
