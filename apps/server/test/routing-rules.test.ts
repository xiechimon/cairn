import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  machine as machineTable,
  routingRule,
  team as teamTable,
  todo as todoTable,
  workPolicy,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import {
  coordinatorProfile,
  profileForStep,
  routeForStep,
  withOverride,
} from '../src/services/routing-rules.js';
import {
  bootServer,
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
