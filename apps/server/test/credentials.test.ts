import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent, step as stepTable } from '../src/db/schema.js';
import { createEphemeralSecretBox, SecretBoxError } from '../src/lib/secret-box.js';
import { startBuilds } from '../src/services/builds.js';
import { resolveStepCredentials } from '../src/services/credentials.js';
import { createProvider } from '../src/services/providers.js';
import { createSecret } from '../src/services/secrets.js';
import { bootServer, postProject, req } from './helpers.js';

const RELAY_KEY = 'sk-relay-per-step';
const STRIPE_VALUE = 'sk_live_stripe';

async function withAgentStack(opts: { secretsGranted?: boolean; withPlan?: boolean } = {}) {
  const s = bootServer();
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
  const agentId = 'agent-xiaolin';
  s.db
    .insert(agent)
    .values({
      id: agentId,
      teamId: s.team.id,
      displayName: '小林',
      status: 'active',
      provider: 'r3-gw',
      modelId: 'claude-sonnet-5',
      tools: [],
      secrets: opts.secretsGranted === false ? [] : [secret.id],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: [],
    })
    .run();
  const projectId = await postProject(s.app);
  const todoDoc = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: '跑任务', spec: '' })
  ).json()) as { id: string };
  const builds = startBuilds(
    { db: s.db, hub: s.hub, user: s.user },
    {
      projectId,
      todoIds: [todoDoc.id],
      assignment: { plan: null, build: { agentId } },
      withPlan: true,
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
    const s = await withAgentStack();
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

  test('per-step narrowing: planning / review / chief-exploration step access surfaces are always empty', async () => {
    const s = await withAgentStack();
    expect(resolveStepCredentials(s.keysvc, s.stepId).secrets).toEqual({});
    expect(resolveStepCredentials(s.keysvc, addStep(s, s.buildId, 'review')).secrets).toEqual({});
    expect(resolveStepCredentials(s.keysvc, addStep(s, s.buildId, 'chief')).secrets).toEqual({});
    expect(resolveStepCredentials(s.keysvc, addStep(s, s.buildId, 'build')).secrets).toEqual({
      STRIPE_API_KEY: STRIPE_VALUE,
    });
  });

  test('secrets switch not granted = empty access surface (per-Agent grant, r2 permission tab)', async () => {
    const s = await withAgentStack({ secretsGranted: false });
    const bundle = resolveStepCredentials(s.keysvc, addStep(s, s.buildId, 'build'));
    expect(bundle.secrets).toEqual({});
    expect(bundle.provider?.apiKey).toBe(RELAY_KEY);
  });

  test('no Agent assigned = provider null + empty access surface; unknown step 404', async () => {
    const s = await withAgentStack();
    const second = (await (
      await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, { title: '裸跑', spec: '' })
    ).json()) as { id: string };
    const builds = startBuilds(
      { db: s.db, hub: s.hub, user: s.user },
      {
        projectId: s.projectId,
        todoIds: [second.id],
        assignment: { plan: null, build: null },
        withPlan: false,
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
    const s = await withAgentStack();
    const buildStepId = addStep(s, s.buildId, 'build');
    const orphaned = { db: s.db, box: createEphemeralSecretBox() };
    expect(() => resolveStepCredentials(orphaned, buildStepId)).toThrow(SecretBoxError);
  });
});
