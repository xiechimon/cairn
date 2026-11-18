import type { ClaimedStep, ClaudeCodeReport } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { builtinModelIds } from '../src/coordinator/runtime/provider.js';
import {
  machine as machineTable,
  provider as providerTable,
  routingRule,
  team as teamTable,
  todo as todoTable,
  workPolicy,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { chiefBinding } from '../src/services/chief.js';
import { createClaudeSubscription } from '../src/services/claude-subscriptions.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { coordinatorRoute } from '../src/services/coordinator-route.js';
import { createProvider } from '../src/services/providers.js';
import {
  anthropicCoordinatorChoice,
  coordinatorMemoryOwner,
  coordinatorProfile,
  listRoutingSettings,
  memoryOwnerOf,
  profileForStep,
  routeForStep,
  upsertRoutingRule,
  withOverride,
} from '../src/services/routing-rules.js';
import {
  bootServer,
  insertClaudeSubscription,
  insertMachine,
  issueApiKey,
  postProject,
  req,
  seedPolicy,
  seedRoute,
  type TestServer,
} from './helpers.js';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});

interface World {
  s: TestServer;
  machineToken: string;
  machineId: string;
  projectId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 50 });
  servers.push(s);
  const key = await issueApiKey(s);
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(
      readyMachine({ teamId: s.team.id, name: 'route-mbp', cliVersion: '0.1.0' }),
    ),
  });
  expect(res.status).toBe(200);
  const machineToken = ((await res.json()) as { token: string }).token;
  const machineId = s.db
    .select({ id: machineTable.id })
    .from(machineTable)
    .where(eq(machineTable.teamId, s.team.id))
    .get()!.id;
  const projectId = await postProject(s.app, 'route-proj');
  return { s, machineToken, machineId, projectId };
}

function sessionRule(s: TestServer, opts: Parameters<typeof seedRoute>[2] = {}): string {
  return seedRoute(s, 'session', {
    provider: 'rule-provider',
    modelId: 'rule-model',
    thinkingLevel: 'high',
    ...opts,
  });
}

async function buildTodo(w: World): Promise<typeof todoTable.$inferSelect> {
  const todoRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
    title: 'route probe',
    spec: 'probe body',
  });
  expect(todoRes.status).toBe(201);
  const todoId = ((await todoRes.json()) as { id: string }).id;
  const started = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
    todoIds: [todoId],
  });
  expect(started.status).toBe(201);
  return w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
}

async function claim(w: World): Promise<ClaimedStep | null> {
  const res = await w.s.app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${w.machineToken}`, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

function insertOtherTeam(s: TestServer): string {
  const otherTeam = newRecordId();
  s.db
    .insert(teamTable)
    .values({ ...s.db.select().from(teamTable).get()!, id: otherTeam, name: 'other-team' })
    .run();
  return otherTeam;
}

describe('profileForStep: the session rule supplies the model and machine', () => {
  test('without a session rule a step has no route', async () => {
    const w = await setupWorld();
    const todoRow = await buildTodo(w);
    expect(profileForStep(w.s.db, todoRow, 'session')).toBeNull();
  });

  test('plan, build, session and verify steps take the rule model, thinking and fallbacks', async () => {
    const w = await setupWorld();
    const ruleId = sessionRule(w.s, {
      machineId: w.machineId,
      fallbackModels: [{ provider: 'rule-provider', modelId: 'rule-fallback' }],
    });
    const todoRow = await buildTodo(w);
    for (const kind of ['plan', 'build', 'session', 'verify'] as const) {
      const profile = profileForStep(w.s.db, todoRow, kind);
      expect(profile?.id).toBe(ruleId);
      expect(profile?.provider).toBe('rule-provider');
      expect(profile?.modelId).toBe('rule-model');
      expect(profile?.thinkingLevel).toBe('high');
      expect(profile?.fallbackModels).toEqual([
        { provider: 'rule-provider', modelId: 'rule-fallback' },
      ]);
      expect(profile?.machineId).toBe(w.machineId);
    }
  });

  test('merge steps run from the session rule', async () => {
    const w = await setupWorld();
    const ruleId = sessionRule(w.s);
    const todoRow = await buildTodo(w);
    expect(profileForStep(w.s.db, todoRow, 'merge')?.id).toBe(ruleId);
  });

  test('a rule without a machine leaves the step to the default Runner', async () => {
    const w = await setupWorld();
    const ruleId = sessionRule(w.s);
    const todoRow = await buildTodo(w);
    expect(profileForStep(w.s.db, todoRow, 'build')?.machineId).toBe(null);
    expect((await claim(w))?.step.kind).toBe('session');
    expect(
      w.s.db.select().from(routingRule).where(eq(routingRule.id, ruleId)).get()?.machineId,
    ).toBe(null);
  });

  test('review steps use the review rule, never the session rule; other teams are not routed', async () => {
    const w = await setupWorld();
    const otherTeam = insertOtherTeam(w.s);
    w.s.db
      .insert(routingRule)
      .values({
        id: newRecordId(),
        teamId: otherTeam,
        use: 'session',
        provider: 'other-provider',
        modelId: 'other-model',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const todoRow = await buildTodo(w);
    expect(routeForStep(w.s.db, todoRow, 'build')).toBeNull();
    sessionRule(w.s);
    expect(profileForStep(w.s.db, todoRow, 'build')?.modelId).toBe('rule-model');
    expect(profileForStep(w.s.db, todoRow, 'review')).toBeNull();
    seedRoute(w.s, 'review', { provider: 'review-provider', modelId: 'review-model' });
    expect(profileForStep(w.s.db, todoRow, 'review')?.modelId).toBe('review-model');
    expect(profileForStep(w.s.db, todoRow, 'build')?.modelId).toBe('rule-model');
  });

  test('the claimed session step carries the rule model to the daemon', async () => {
    const w = await setupWorld();
    sessionRule(w.s);
    await buildTodo(w);
    const claimed = await claim(w);
    expect(claimed?.step.kind).toBe('session');
    expect(claimed?.agent?.modelId).toBe('rule-model');
    expect(claimed?.agent?.provider).toBe('rule-provider');
  });

  test('deleting the rule machine clears the rule machine instead of failing on the foreign key', async () => {
    const w = await setupWorld();
    const spare = newRecordId();
    w.s.db
      .insert(machineTable)
      .values(
        readyMachine({
          id: spare,
          teamId: w.s.team.id,
          name: 'route-spare',
          tokenHash: 'y'.repeat(64),
          createdAt: 1,
        }) as typeof machineTable.$inferInsert,
      )
      .run();
    sessionRule(w.s, { machineId: spare });
    const res = await req(w.s.app, 'DELETE', `/api/machines/${spare}`);
    expect(res.status).toBe(204);
    expect(w.s.db.select().from(routingRule).get()?.machineId).toBeNull();
  });
});

describe('project task model: overrides the session rule for one project', () => {
  test('the project choice replaces model and thinking for its tasks only, review keeps its rule, and null clears it', async () => {
    const w = await setupWorld();
    const ruleId = sessionRule(w.s, { machineId: w.machineId });
    seedRoute(w.s, 'review', { provider: 'review-provider', modelId: 'review-model' });
    const otherProjectId = await postProject(w.s.app, 'route-proj-other');
    const choice = { provider: 'project-provider', modelId: 'project-model', thinkingLevel: 'low' };
    const patched = await req(w.s.app, 'PATCH', `/api/projects/${w.projectId}`, {
      modelOverrides: { session: choice },
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { modelOverrides?: unknown }).modelOverrides).toEqual({
      session: choice,
    });
    const todoRow = await buildTodo(w);
    const profile = profileForStep(w.s.db, todoRow, 'build');
    expect(profile).toMatchObject({
      id: ruleId,
      provider: 'project-provider',
      modelId: 'project-model',
      thinkingLevel: 'low',
      machineId: w.machineId,
    });
    expect(profileForStep(w.s.db, todoRow, 'review')?.modelId).toBe('review-model');
    expect(
      routeForStep(w.s.db, { teamId: w.s.team.id, projectId: otherProjectId }, 'build')?.modelId,
    ).toBe('rule-model');
    expect((await claim(w))?.agent?.modelId).toBe('project-model');
    const cleared = await req(w.s.app, 'PATCH', `/api/projects/${w.projectId}`, {
      modelOverrides: { session: null },
    });
    expect(cleared.status).toBe(200);
    expect('modelOverrides' in ((await cleared.json()) as object)).toBe(false);
    expect(profileForStep(w.s.db, todoRow, 'build')?.modelId).toBe('rule-model');
  });

  test('without a team session rule the project choice still routes its tasks', async () => {
    const w = await setupWorld();
    await req(w.s.app, 'PATCH', `/api/projects/${w.projectId}`, {
      modelOverrides: {
        session: { provider: 'project-provider', modelId: 'project-model', thinkingLevel: null },
      },
    });
    const todoRow = await buildTodo(w);
    expect(routeForStep(w.s.db, todoRow, 'session')?.modelId).toBe('project-model');
  });
});

describe('D71 the session rule carries the hard constraints', () => {
  test('the rule constraints are the step constraints', async () => {
    const w = await setupWorld();
    sessionRule(w.s, { requiredCapabilities: { executor: 'orb' } });
    const todoRow = await buildTodo(w);
    expect(profileForStep(w.s.db, todoRow, 'build')?.requiredCapabilities).toEqual({
      executor: 'orb',
    });
  });

  test('a rule without constraints requires nothing', async () => {
    const w = await setupWorld();
    sessionRule(w.s);
    const todoRow = await buildTodo(w);
    expect(profileForStep(w.s.db, todoRow, 'build')?.requiredCapabilities ?? null).toBeNull();
  });

  test('the coordinator rule constraints stay on the coordinator profile and out of session steps', async () => {
    const w = await setupWorld();
    sessionRule(w.s);
    seedRoute(w.s, 'coordinator', {
      provider: 'p',
      modelId: 'm',
      requiredCapabilities: { executor: 'orb' },
    });
    const todoRow = await buildTodo(w);
    expect(coordinatorProfile(w.s.db, w.s.team.id)?.requiredCapabilities).toEqual({
      executor: 'orb',
    });
    expect(profileForStep(w.s.db, todoRow, 'build')?.requiredCapabilities ?? null).toBeNull();
  });
});

describe('D71 thread override merge: add, never remove', () => {
  test('union of rule and override; the rule Orb requirement survives an override without it', () => {
    expect(
      withOverride({ executor: 'orb', mcpServers: ['figma'] }, { mcpServers: ['context7'] }),
    ).toEqual({ executor: 'orb', mcpServers: ['figma', 'context7'] });
    expect(withOverride({ executor: 'orb' }, {})).toEqual({ executor: 'orb' });
    expect(withOverride(null, { executor: 'orb' })).toEqual({ executor: 'orb' });
    expect(withOverride(null, undefined)).toBeNull();
  });
});

describe('D71 thread override set at dispatch', () => {
  async function start(w: World, routeOverride: unknown) {
    const todoRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
      title: 'override probe',
      spec: 'probe body',
    });
    const todoId = ((await todoRes.json()) as { id: string }).id;
    const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
      todoIds: [todoId],
      routeOverride,
    });
    return { res, todoId };
  }

  test('the override is stored on the task with the dispatch and read by the route', async () => {
    const w = await setupWorld();
    sessionRule(w.s, { requiredCapabilities: { executor: 'orb' } });
    const { res, todoId } = await start(w, {
      machineId: w.machineId,
      requiredCapabilities: { mcpServers: ['figma'] },
    });
    expect(res.status).toBe(201);
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
    expect(todoRow.routeOverride).toEqual({
      machineId: w.machineId,
      requiredCapabilities: { mcpServers: ['figma'] },
    });
    const profile = profileForStep(w.s.db, todoRow, 'build');
    expect(profile?.requiredCapabilities).toEqual({
      mcpServers: ['figma'],
      executor: 'orb',
    });
    expect(profile?.machineId).toBe(w.machineId);
  });

  test('a capabilities-only start keeps the task machine pin', async () => {
    const w = await setupWorld();
    const todoRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
      title: 'keep pin',
      spec: 'probe',
    });
    const todoId = ((await todoRes.json()) as { id: string }).id;
    w.s.db
      .update(todoTable)
      .set({ routeOverride: { machineId: w.machineId } })
      .where(eq(todoTable.id, todoId))
      .run();
    const started = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
      todoIds: [todoId],
      routeOverride: { requiredCapabilities: { mcpServers: ['figma'] } },
    });
    expect(started.status).toBe(201);
    expect(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.routeOverride,
    ).toEqual({
      machineId: w.machineId,
      requiredCapabilities: { mcpServers: ['figma'] },
    });
  });

  test('an override naming a machine outside the team is refused', async () => {
    const w = await setupWorld();
    const { res } = await start(w, { machineId: newRecordId() });
    expect(res.status).toBe(404);
  });

  test('PATCH stores the override on the todo and startBuilds without a body keeps it', async () => {
    const w = await setupWorld();
    const todoRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
      title: 'patch override',
      spec: 'probe',
    });
    const todoId = ((await todoRes.json()) as { id: string }).id;
    const patched = await req(w.s.app, 'PATCH', `/api/todos/${todoId}`, {
      routeOverride: {
        machineId: w.machineId,
        requiredCapabilities: { executor: 'orb', mcpServers: ['figma'] },
      },
    });
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as { routeOverride: unknown };
    expect(body.routeOverride).toEqual({
      machineId: w.machineId,
      requiredCapabilities: { executor: 'orb', mcpServers: ['figma'] },
    });
    const started = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
      todoIds: [todoId],
    });
    expect(started.status).toBe(201);
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
    expect(todoRow.routeOverride).toEqual({
      machineId: w.machineId,
      requiredCapabilities: { executor: 'orb', mcpServers: ['figma'] },
    });
  });

  test('PATCH refuses a machine outside the team', async () => {
    const w = await setupWorld();
    const todoRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
      title: 'bad machine',
      spec: 'probe',
    });
    const todoId = ((await todoRes.json()) as { id: string }).id;
    const res = await req(w.s.app, 'PATCH', `/api/todos/${todoId}`, {
      routeOverride: { machineId: newRecordId() },
    });
    expect(res.status).toBe(404);
  });

  test('PATCH null clears the override', async () => {
    const w = await setupWorld();
    const todoRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
      title: 'clear override',
      spec: 'probe',
    });
    const todoId = ((await todoRes.json()) as { id: string }).id;
    w.s.db
      .update(todoTable)
      .set({ routeOverride: { machineId: w.machineId } })
      .where(eq(todoTable.id, todoId))
      .run();
    const res = await req(w.s.app, 'PATCH', `/api/todos/${todoId}`, { routeOverride: null });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { routeOverride?: unknown }).routeOverride).toBeUndefined();
    expect(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!.routeOverride,
    ).toBeNull();
  });
});

describe('work_policy: tools, skills and secrets live on the policy', () => {
  test('the policy values are the step permissions', async () => {
    const w = await setupWorld();
    sessionRule(w.s);
    seedPolicy(w.s, 'session', {
      tools: ['policy-tool'],
      skillsAllowlist: ['policy-skill'],
      defaultSkill: 'policy-skill',
      secrets: ['POLICY_SECRET'],
    });
    const todoRow = await buildTodo(w);
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({
      tools: ['policy-tool'],
      skillsAllowlist: ['policy-skill'],
      defaultSkill: 'policy-skill',
      secrets: ['POLICY_SECRET'],
    });
  });

  test('permission columns left on the routing rule grant nothing', async () => {
    const w = await setupWorld();
    const ruleId = sessionRule(w.s);
    w.s.db
      .update(routingRule)
      .set({ tools: ['rule-tool'], secrets: ['RULE_SECRET'] })
      .where(eq(routingRule.id, ruleId))
      .run();
    const todoRow = await buildTodo(w);
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({
      tools: [],
      secrets: [],
    });
  });

  test('another team policy is never applied', async () => {
    const w = await setupWorld();
    sessionRule(w.s);
    const otherTeam = insertOtherTeam(w.s);
    w.s.db
      .insert(workPolicy)
      .values({
        id: newRecordId(),
        teamId: otherTeam,
        use: 'session',
        tools: [],
        mcpServers: [],
        secrets: ['OTHER_SECRET'],
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const todoRow = await buildTodo(w);
    expect(profileForStep(w.s.db, todoRow, 'build')?.secrets).toEqual([]);
  });

  test('a session step with no policy gets no permissions', async () => {
    const w = await setupWorld();
    sessionRule(w.s);
    const todoRow = await buildTodo(w);
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({
      tools: [],
      secrets: [],
      skillsAllowlist: [],
    });
  });

  test('review steps read the review policy, not the session policy', async () => {
    const w = await setupWorld();
    sessionRule(w.s);
    seedRoute(w.s, 'review', { provider: 'review-provider', modelId: 'review-model' });
    seedPolicy(w.s, 'session', { tools: ['session-tool'], secrets: ['SESSION_SECRET'] });
    seedPolicy(w.s, 'review', { tools: ['read-only-tool'] });
    const todoRow = await buildTodo(w);
    expect(profileForStep(w.s.db, todoRow, 'review')).toMatchObject({
      tools: ['read-only-tool'],
      secrets: [],
    });
  });

  test('the coordinator profile takes no session policy permissions', async () => {
    const w = await setupWorld();
    seedRoute(w.s, 'coordinator', { provider: 'p', modelId: 'm' });
    seedPolicy(w.s, 'session', { tools: ['session-tool'], secrets: ['SESSION_SECRET'] });
    expect(coordinatorProfile(w.s.db, w.s.team.id)).toMatchObject({
      tools: [],
      secrets: [],
    });
  });
});

describe('rules store provider ids, with a read-time default for Session', () => {
  function bare(): TestServer {
    const s = bootServer();
    servers.push(s);
    return s;
  }

  function addProvider(
    s: TestServer,
    providerId: string,
    opts: { key?: boolean; models?: string[]; createdAt?: number } = {},
  ): void {
    createProvider(
      { db: s.db, box: s.secretBox },
      {
        teamId: s.team.id,
        body: {
          providerId,
          label: providerId,
          baseUrl: 'http://127.0.0.1:8798/v1',
          api: 'openai-completions',
          ...(opts.key === false ? {} : { apiKey: `${providerId}-key` }),
          models: (opts.models ?? []).map((id) => ({ id, name: id })),
        },
        createdBy: s.user.id,
      },
    );
    if (opts.createdAt !== undefined) {
      s.db
        .update(providerTable)
        .set({ createdAt: opts.createdAt })
        .where(eq(providerTable.providerId, providerId))
        .run();
    }
  }

  function claudeRunner(
    s: TestServer,
    online = true,
    auth: ClaudeCodeReport['auth'] = undefined,
  ): string {
    const id = insertMachine(s, {
      enabledRuntimes: ['pi', 'claude-code'],
      claudeCodeReport: {
        installed: true,
        hostname: 'h',
        models: [],
        ...(auth !== undefined ? { auth } : {}),
      },
    });
    s.db.update(machineTable).set({ online }).where(eq(machineTable.id, id)).run();
    return id;
  }

  function piOnlyRunner(s: TestServer, codex: 'ok' | 'absent' = 'absent'): string {
    const id = insertMachine(s, { enabledRuntimes: ['pi'] });
    const row = s.db.select().from(machineTable).where(eq(machineTable.id, id)).get()!;
    s.db
      .update(machineTable)
      .set({
        capabilities: {
          ...row.capabilities!,
          codexLogin: {
            state: codex,
            ...(codex === 'ok' ? { expiresAt: Date.now() + 3_600_000 } : {}),
          },
        },
      })
      .where(eq(machineTable.id, id))
      .run();
    return id;
  }

  const session = (s: TestServer) => routeForStep(s.db, { teamId: s.team.id }, 'build');

  test('a rule saved as the runtime pi resolves to the runnable provider that stores the model', () => {
    const s = bare();
    addProvider(s, 'deepseek', { key: false, models: ['m1'], createdAt: 1 });
    addProvider(s, 'local-llm', { key: false, models: ['m1'], createdAt: 2 });
    addProvider(s, 'vani', { models: ['m1'], createdAt: 3 });
    seedRoute(s, 'session', { provider: 'pi', modelId: 'm1' });
    expect(session(s)).toMatchObject({ provider: 'local-llm', modelId: 'm1' });
    seedRoute(s, 'session', { provider: 'pi', modelId: 'nobody-serves-this' });
    expect(session(s)).toMatchObject({ provider: 'pi', modelId: 'nobody-serves-this' });
  });

  test('a team that owns a provider named pi keeps its pi rules on that provider', () => {
    const s = bare();
    addProvider(s, 'vani', { models: ['m1'] });
    addProvider(s, 'pi', { models: ['m1'] });
    seedRoute(s, 'session', { provider: 'pi', modelId: 'm1' });
    expect(session(s)).toMatchObject({ provider: 'pi', modelId: 'm1' });
  });

  test('a pi rule for a built-in vendor model resolves for Runners but not for the in-server Coordinator', () => {
    const s = bare();
    const modelId = [...builtinModelIds('deepseek')][0]!;
    addProvider(s, 'deepseek');
    seedRoute(s, 'session', { provider: 'pi', modelId });
    seedRoute(s, 'coordinator', { provider: 'pi', modelId });
    expect(session(s)).toMatchObject({ provider: 'deepseek', modelId });
    expect(coordinatorProfile(s.db, s.team.id)).toMatchObject({ provider: 'deepseek', modelId });
    setCoordinatorInServer(true);
    expect(coordinatorRoute(s.db, s.team.id)).toBeNull();
    setCoordinatorInServer(false);
  });

  test('with no stored Session rule, a Claude subscription and a Runner with Claude Code give the routed default even while offline', () => {
    const s = bare();
    claudeRunner(s, false);
    addProvider(s, 'vani', { models: ['m1'] });
    expect(session(s)).toMatchObject({ provider: 'vani', modelId: 'm1' });
    insertClaudeSubscription(s);
    expect(session(s)).toMatchObject({
      id: 'default-session',
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
  });

  test('a Runner Codex login is no model source: the Session default stays on the provider', () => {
    const s = bare();
    piOnlyRunner(s, 'ok');
    addProvider(s, 'deepseek', { key: false, models: ['m0'], createdAt: 1 });
    addProvider(s, 'vani', { models: ['m1', 'm2'], createdAt: 2 });
    expect(session(s)).toMatchObject({ provider: 'vani', modelId: 'm1' });
  });

  test('a Runner signed in to Claude Code without a stored subscription is no Session or Coordinator default', () => {
    const s = bare();
    claudeRunner(s, true, { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' });
    const settings = () => listRoutingSettings(s.db, s.team.id, true);
    expect(settings().sessionDefault).toEqual({ reason: 'none', provider: null, modelId: null });
    expect(settings().coordinatorDefault).toEqual({
      reason: 'none',
      provider: null,
      modelId: null,
    });
    insertClaudeSubscription(s);
    expect(settings().sessionDefault).toMatchObject({ reason: 'claude-code' });
    expect(settings().coordinatorDefault).toMatchObject({ reason: 'claude-code' });
  });

  test('the provider default takes a Claude model on a provider, and nothing runnable means no rule', () => {
    const s = bare();
    piOnlyRunner(s);
    expect(session(s)).toBeNull();
    addProvider(s, 'claude-proxy', { key: false, models: ['claude-sonnet-5-5'] });
    expect(session(s)).toMatchObject({ provider: 'claude-proxy', modelId: 'claude-sonnet-5-5' });
  });

  test('a stored stock seed falls back to the provider until a subscription and Claude Code both exist', () => {
    const s = bare();
    seedRoute(s, 'session', { provider: 'claude-code', modelId: 'claude-sonnet-5-5' });
    addProvider(s, 'vani', { models: ['m1'] });
    piOnlyRunner(s);
    const todoRow = { teamId: s.team.id };
    expect(profileForStep(s.db, todoRow, 'build')).toMatchObject({
      provider: 'vani',
      modelId: 'm1',
    });
    claudeRunner(s, false);
    expect(profileForStep(s.db, todoRow, 'build')).toMatchObject({
      provider: 'vani',
      modelId: 'm1',
    });
    insertClaudeSubscription(s);
    expect(profileForStep(s.db, todoRow, 'build')).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
  });

  test('routing settings report the read-time Session default and why, until a Session rule is stored', async () => {
    const s = bare();
    const sessionDefault = () => listRoutingSettings(s.db, s.team.id).sessionDefault;
    piOnlyRunner(s);
    expect(sessionDefault()).toEqual({ reason: 'none', provider: null, modelId: null });
    addProvider(s, 'vani', { models: ['m1'] });
    expect(sessionDefault()).toEqual({ reason: 'provider', provider: 'vani', modelId: 'm1' });
    piOnlyRunner(s, 'ok');
    expect(sessionDefault()).toEqual({ reason: 'provider', provider: 'vani', modelId: 'm1' });
    claudeRunner(s, false);
    expect(sessionDefault()).toEqual({ reason: 'provider', provider: 'vani', modelId: 'm1' });
    insertClaudeSubscription(s);
    expect(sessionDefault()).toMatchObject({ reason: 'claude-code', provider: 'claude-code' });
    seedRoute(s, 'session', { provider: 'vani', modelId: 'm1' });
    expect(sessionDefault()).toBeUndefined();
    const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/routing-settings`);
    expect(((await res.json()) as { sessionDefault?: unknown }).sessionDefault).toBeUndefined();
  });

  test('with no stored Coordinator rule, the in-server Coordinator routes to the earliest provider it can run and stores nothing', () => {
    const s = bare();
    addProvider(s, 'deepseek', { key: false, models: ['m0'], createdAt: 1 });
    addProvider(s, 'vani', { models: ['m1', 'm2'], createdAt: 2 });
    setCoordinatorInServer(true);
    try {
      expect(coordinatorRoute(s.db, s.team.id)).toMatchObject({ provider: 'vani', modelId: 'm1' });
      expect(coordinatorProfile(s.db, s.team.id)).toMatchObject({ provider: 'vani' });
      expect(coordinatorMemoryOwner(s.db, s.team.id)).toBeUndefined();
      expect(listRoutingSettings(s.db, s.team.id, true).coordinatorDefault).toEqual({
        reason: 'provider',
        provider: 'vani',
        modelId: 'm1',
      });
      expect(listRoutingSettings(s.db, s.team.id, true).rules).toEqual([]);
    } finally {
      setCoordinatorInServer(false);
    }
    expect(coordinatorRoute(s.db, s.team.id)).toBeNull();
    expect(listRoutingSettings(s.db, s.team.id).coordinatorDefault).toBeUndefined();
  });

  test('every Coordinator routing reader sees the default, while memory and identity wait for a stored rule', () => {
    const s = bare();
    addProvider(s, 'vani', { models: ['m1'] });
    expect(chiefBinding(s.svc, s.team.id)).toEqual({ agentId: null, canOrchestrate: false });
    setCoordinatorInServer(true);
    try {
      expect(chiefBinding(s.svc, s.team.id)).toEqual({ agentId: null, canOrchestrate: true });
      expect(coordinatorMemoryOwner(s.db, s.team.id)).toBeUndefined();
      const ruleId = seedRoute(s, 'coordinator', { provider: 'vani', modelId: 'm1' });
      expect(chiefBinding(s.svc, s.team.id)).toEqual({ agentId: ruleId, canOrchestrate: true });
      expect(coordinatorMemoryOwner(s.db, s.team.id)).toBe(ruleId);
    } finally {
      setCoordinatorInServer(false);
    }
  });

  test('of two Anthropic keys the Coordinator default takes the one added first', () => {
    const s = bare();
    for (const providerId of ['anthropic-b', 'anthropic-a']) {
      createProvider(
        { db: s.db, box: s.secretBox },
        {
          teamId: s.team.id,
          body: {
            providerId,
            label: providerId,
            baseUrl: 'https://api.anthropic.com',
            api: 'anthropic-messages',
            apiKey: `${providerId}-key`,
            models: [{ id: 'claude-haiku-5-5', name: 'Haiku' }],
          },
          createdBy: s.user.id,
        },
      );
    }
    s.db
      .update(providerTable)
      .set({ createdAt: 1 })
      .where(eq(providerTable.providerId, 'anthropic-a'))
      .run();
    expect(anthropicCoordinatorChoice(s.db, s.team.id)?.provider).toBe('anthropic-a');
  });

  test('the Coordinator default prefers an Anthropic key, says when nothing can run it, and yields to a stored rule', () => {
    const s = bare();
    const coordinatorDefault = () => listRoutingSettings(s.db, s.team.id, true).coordinatorDefault;
    expect(coordinatorDefault()).toEqual({ reason: 'none', provider: null, modelId: null });
    addProvider(s, 'deepseek', { key: false, models: ['m0'] });
    expect(coordinatorDefault()).toEqual({ reason: 'none', provider: null, modelId: null });
    addProvider(s, 'vani', { models: ['m1'] });
    createProvider(
      { db: s.db, box: s.secretBox },
      {
        teamId: s.team.id,
        body: {
          providerId: 'anthropic',
          label: 'Anthropic',
          baseUrl: 'https://api.anthropic.com',
          api: 'anthropic-messages',
          apiKey: 'sk-ant-test',
          models: [
            { id: 'claude-sonnet-5-5', name: 'Sonnet' },
            { id: 'claude-haiku-5-5', name: 'Haiku' },
          ],
        },
        createdBy: s.user.id,
      },
    );
    expect(coordinatorDefault()).toEqual({
      reason: 'anthropic-key',
      provider: 'anthropic',
      modelId: 'claude-haiku-5-5',
    });
    seedRoute(s, 'coordinator', { provider: 'vani', modelId: 'm1' });
    expect(coordinatorDefault()).toBeUndefined();
  });

  test('a Claude subscription with Claude Code installed is the Coordinator default when nothing else can run it', () => {
    const s = bare();
    const coordinatorDefault = () => listRoutingSettings(s.db, s.team.id, true).coordinatorDefault;
    const subscribe = (expiresAt: number | null = null) =>
      createClaudeSubscription({ db: s.db, box: s.secretBox }, s.team.id, {
        label: 'mine',
        token: 'sk-ant-oat01-first-run',
        ...(expiresAt === null ? {} : { expiresAt }),
      });
    const none = { reason: 'none', provider: null, modelId: null };
    subscribe();
    expect(coordinatorDefault()).toEqual(none);
    const machineId = claudeRunner(s);
    expect(coordinatorDefault()).toEqual({
      reason: 'claude-code',
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
    setCoordinatorInServer(true);
    try {
      expect(coordinatorProfile(s.db, s.team.id)).toMatchObject({
        provider: 'claude-code',
        modelId: 'claude-sonnet-5-5',
      });
      expect(coordinatorRoute(s.db, s.team.id)).toBeNull();
    } finally {
      setCoordinatorInServer(false);
    }
    s.db
      .update(machineTable)
      .set({ claudeCodeReport: null })
      .where(eq(machineTable.id, machineId))
      .run();
    expect(coordinatorDefault()).toEqual(none);
  });

  test('with several Runners the seeded Coordinator rule is pinned to the one that has Claude Code', async () => {
    const s = bare();
    piOnlyRunner(s);
    const withClaude = claudeRunner(s);
    await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions`, {
      label: 'mine',
      token: `sk-ant-oat01-pin-${'x'.repeat(60)}`,
    });
    const rule = listRoutingSettings(s.db, s.team.id, true).rules.find(
      (r) => r.use === 'coordinator',
    );
    expect(rule).toMatchObject({ provider: 'claude-code', machineId: withClaude });
  });

  test('an expired subscription is no Coordinator default, and a provider key still comes first', () => {
    const s = bare();
    const coordinatorDefault = () => listRoutingSettings(s.db, s.team.id, true).coordinatorDefault;
    claudeRunner(s);
    createClaudeSubscription({ db: s.db, box: s.secretBox }, s.team.id, {
      label: 'old',
      token: 'sk-ant-oat01-expired',
      expiresAt: Date.now() - 1_000,
    });
    expect(coordinatorDefault()).toEqual({ reason: 'none', provider: null, modelId: null });
    createClaudeSubscription({ db: s.db, box: s.secretBox }, s.team.id, {
      label: 'live',
      token: 'sk-ant-oat01-live',
    });
    addProvider(s, 'vani', { models: ['m1'] });
    expect(coordinatorDefault()).toEqual({ reason: 'provider', provider: 'vani', modelId: 'm1' });
  });

  test('signing in a first Claude subscription saves the Coordinator and task rules, and leaves another source alone', async () => {
    const s = bare();
    claudeRunner(s);
    const subscribe = (label: string) =>
      req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions`, {
        label,
        token: `sk-ant-oat01-${label}-${'x'.repeat(60)}`,
      });
    expect((await subscribe('first')).status).toBe(201);
    const rules = () =>
      Object.fromEntries(
        listRoutingSettings(s.db, s.team.id, true).rules.map((r) => [
          r.use,
          [r.provider, r.modelId],
        ]),
      );
    expect(rules()).toEqual({
      coordinator: ['claude-code', 'claude-sonnet-5-5'],
      session: ['claude-code', 'claude-sonnet-5-5'],
    });
    s.db.delete(routingRule).run();
    expect((await subscribe('second')).status).toBe(201);
    expect(rules()).toEqual({});

    const other = bare();
    claudeRunner(other);
    addProvider(other, 'vani', { models: ['m1'] });
    await req(other.app, 'POST', `/api/teams/${other.team.id}/claude-subscriptions`, {
      label: 'mine',
      token: `sk-ant-oat01-mine-${'x'.repeat(60)}`,
    });
    expect(
      listRoutingSettings(other.db, other.team.id, true).rules.map((r) => [r.use, r.provider]),
    ).toEqual([['session', 'claude-code']]);
  });

  test('memory ownership stays on the stored rule, not the read-time default', () => {
    const s = bare();
    claudeRunner(s);
    expect(memoryOwnerOf(s.db, s.team.id, 'verify')).toBe(`${s.team.id}:verify`);
  });

  test('naming a Runner on an empty Session rule creates it with the default provider and model', () => {
    const s = bare();
    const machineId = piOnlyRunner(s);
    addProvider(s, 'vani', { models: ['m1'] });
    expect(upsertRoutingRule(s.db, s.team.id, 'session', { machineId })).toMatchObject({
      provider: 'vani',
      modelId: 'm1',
      machineId,
    });
  });
});
