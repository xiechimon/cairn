import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { builtinModelIds } from '../src/coordinator/runtime/provider.js';
import {
  machine as machineTable,
  routingRule,
  team as teamTable,
  todo as todoTable,
  workPolicy,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { setCoordinatorServerContextEnabled } from '../src/services/coordinator-context.js';
import { coordinatorRoute } from '../src/services/coordinator-route.js';
import { createProvider } from '../src/services/providers.js';
import {
  coordinatorProfile,
  memoryOwnerOf,
  profileForStep,
  routeForStep,
  upsertRoutingRule,
  withOverride,
} from '../src/services/routing-rules.js';
import {
  bootServer,
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

describe('work_policy: tools, MCP, skills and secrets live on the policy', () => {
  test('the policy values are the step permissions', async () => {
    const w = await setupWorld();
    sessionRule(w.s);
    seedPolicy(w.s, 'session', {
      tools: ['policy-tool'],
      mcpServers: ['policy-mcp'],
      skillsAllowlist: ['policy-skill'],
      defaultSkill: 'policy-skill',
      secrets: ['POLICY_SECRET'],
    });
    const todoRow = await buildTodo(w);
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({
      tools: ['policy-tool'],
      mcpServers: ['policy-mcp'],
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
      .set({ tools: ['rule-tool'], mcpServers: ['rule-mcp'], secrets: ['RULE_SECRET'] })
      .where(eq(routingRule.id, ruleId))
      .run();
    const todoRow = await buildTodo(w);
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({
      tools: [],
      mcpServers: [],
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
      mcpServers: [],
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
    seedRoute(w.s, 'coordinator', { provider: 'p', modelId: 'm', mcpServers: ['coord-mcp'] });
    seedPolicy(w.s, 'session', { tools: ['session-tool'], secrets: ['SESSION_SECRET'] });
    expect(coordinatorProfile(w.s.db, w.s.team.id)).toMatchObject({
      tools: [],
      secrets: [],
      mcpServers: ['coord-mcp'],
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
  }

  function claudeRunner(s: TestServer, online = true): string {
    const id = insertMachine(s, {
      enabledRuntimes: ['pi', 'claude-code'],
      claudeCodeReport: { installed: true, hostname: 'h', models: [] },
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
    addProvider(s, 'deepseek', { key: false, models: ['m1'] });
    addProvider(s, 'local-llm', { key: false, models: ['m1'] });
    addProvider(s, 'vani', { models: ['m1'] });
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
    setCoordinatorServerContextEnabled(true);
    expect(coordinatorRoute(s.db, s.team.id)).toBeNull();
    setCoordinatorServerContextEnabled(false);
  });

  test('with no stored Session rule, a Runner with Claude Code gives the routed default even while offline', () => {
    const s = bare();
    claudeRunner(s, false);
    addProvider(s, 'vani', { models: ['m1'] });
    expect(session(s)).toMatchObject({
      id: 'default-session',
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
  });

  test('a Codex login counts only when it exists; an absent one falls through to the provider', () => {
    const s = bare();
    piOnlyRunner(s, 'absent');
    addProvider(s, 'deepseek', { key: false, models: ['m0'] });
    addProvider(s, 'vani', { models: ['m1', 'm2'] });
    expect(session(s)).toMatchObject({ provider: 'vani', modelId: 'm1' });
    piOnlyRunner(s, 'ok');
    expect(session(s)).toMatchObject({ provider: 'claude-code' });
  });

  test('the provider default skips Claude models the team does not pay for, and nothing runnable means no rule', () => {
    const s = bare();
    piOnlyRunner(s);
    expect(session(s)).toBeNull();
    addProvider(s, 'claude-proxy', { key: false, models: ['claude-sonnet-5-5'] });
    expect(session(s)).toBeNull();
    s.db
      .update(teamTable)
      .set({ claudeUsage: 'allow-paid' })
      .where(eq(teamTable.id, s.team.id))
      .run();
    expect(session(s)).toMatchObject({ provider: 'claude-proxy', modelId: 'claude-sonnet-5-5' });
  });

  test('a stored stock seed falls back to the provider only when no Claude Code or Codex exists at all', () => {
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
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
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
