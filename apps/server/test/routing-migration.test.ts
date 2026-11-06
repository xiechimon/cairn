import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AGENT_TOOL_DEFAULTS,
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  type ClaimedStep,
  claimedStepSchema,
  ENV_VARS,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  agentMemory,
  agent as agentTable,
  build,
  chief,
  machine as machineTable,
  routingRule,
  step,
  team as teamTable,
  todo as todoTable,
  workPolicy,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { buildRunsSession, startBuilds } from '../src/services/builds.js';
import { resolveStepCredentials } from '../src/services/credentials.js';
import { agentForStep, unassignedStepReason } from '../src/services/dispatch-eligibility.js';
import { runRoutingMigration } from '../src/services/routing-migration.js';
import { setRoutingRulesEnabled } from '../src/services/routing-rules.js';
import { bootServer, issueApiKey, postProject, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});
afterEach(() => {
  setRoutingRulesEnabled(false);
  vi.unstubAllEnvs();
});

interface World {
  s: TestServer;
  machineToken: string;
  machineId: string;
  projectId: string;
}

async function legacyWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 50 });
  servers.push(s);
  const key = await issueApiKey(s);
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'legacy-mbp', cliVersion: '0.1.0' }),
  });
  expect(res.status).toBe(200);
  const machineToken = ((await res.json()) as { token: string }).token;
  const machineId = s.db
    .select({ id: machineTable.id })
    .from(machineTable)
    .where(eq(machineTable.teamId, s.team.id))
    .get()!.id;
  const projectId = await postProject(s.app, 'legacy-proj');
  return { s, machineToken, machineId, projectId };
}

function legacyAgent(
  w: World,
  id: string,
  over: Partial<typeof agentTable.$inferInsert> = {},
): void {
  w.s.db
    .insert(agentTable)
    .values({
      id,
      teamId: w.s.team.id,
      displayName: id,
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      machineId: w.machineId,
      tools: [],
      secrets: [],
      mcpServers: [],
      ...over,
    })
    .run();
}

function seedLegacyAgents(w: World, runnable = false): void {
  legacyAgent(w, 'impl', {
    persona: 'implementer',
    ...(runnable ? { provider: 'stub-gw', modelId: 'old-model' } : {}),
    tools: [AGENT_TOOL_PUSH],
    secrets: ['SECRET_IMPL'],
    mcpServers: ['impl-mcp'],
    skillsAllowlist: ['impl-skill'],
    defaultSkill: 'impl-skill',
  });
  legacyAgent(w, 'reviewer', {
    persona: 'code_reviewer',
    provider: 'openai',
    modelId: 'gpt-6.1-sol',
    tools: [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH],
    secrets: ['SECRET_REVIEW'],
  });
  legacyAgent(w, 'verifier', { persona: 'verifier', secrets: ['SECRET_VERIFY'] });
  legacyAgent(w, 'docs', { secrets: ['SECRET_DOCS'] });
}

function legacyTodo(w: World, id: string, over: Partial<typeof todoTable.$inferInsert> = {}) {
  w.s.db
    .insert(todoTable)
    .values({
      id,
      teamId: w.s.team.id,
      projectId: w.projectId,
      title: id,
      spec: 'legacy',
      phase: 'todo',
      phaseAt: 1,
      seqNum: w.s.db.select().from(todoTable).all().length + 1,
      ...over,
    })
    .run();
}

function deps(w: World) {
  return {
    db: w.s.db,
    hub: w.s.hub,
    convHub: w.s.convHub,
    machineHub: w.s.machineHub,
    user: w.s.user,
  };
}

function startLegacyBuild(w: World, todoId: string, withPlan: boolean): string {
  setRoutingRulesEnabled(false);
  const [started] = startBuilds(deps(w), {
    projectId: w.projectId,
    todoIds: [todoId],
    assignment: { plan: { agentId: 'impl' }, build: { agentId: 'impl' } },
    withPlan,
  });
  return started!.id;
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

function tableSnapshot(w: World): string {
  return JSON.stringify({
    agents: w.s.db.select().from(agentTable).all(),
    todos: w.s.db.select().from(todoTable).all(),
    builds: w.s.db.select().from(build).all(),
    steps: w.s.db.select().from(step).all(),
    chiefs: w.s.db.select().from(chief).all(),
  });
}

describe('the routing path is on by default', () => {
  test('loadConfig turns it on unless CAIRN_ROUTING_RULES switches it off', () => {
    vi.stubEnv(ENV_VARS.routingRules, '');
    expect(loadConfig().routingRules).toBe(true);
    vi.stubEnv(ENV_VARS.routingRules, '1');
    expect(loadConfig().routingRules).toBe(true);
    vi.stubEnv(ENV_VARS.routingRules, '0');
    expect(loadConfig().routingRules).toBe(false);
  });
});

describe('runRoutingMigration on a seeded legacy install', () => {
  let w: World;
  beforeEach(async () => {
    w = await legacyWorld();
    seedLegacyAgents(w);
  });

  test('seeds the session rule and policy from the implementer and keeps reviewers read-only', () => {
    const report = runRoutingMigration(w.s.db);
    const rules = w.s.db.select().from(routingRule).all();
    expect(rules.map((r) => r.use).sort()).toEqual(['review', 'session']);
    expect(rules.find((r) => r.use === 'session')).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      machineId: w.machineId,
      seededFromAgentId: 'impl',
    });
    const policies = w.s.db.select().from(workPolicy).all();
    expect(policies.find((p) => p.use === 'session')).toMatchObject({
      tools: [AGENT_TOOL_PUSH],
      secrets: ['SECRET_IMPL'],
      mcpServers: ['impl-mcp'],
    });
    expect(policies.find((p) => p.use === 'review')).toMatchObject({
      tools: [],
      secrets: [],
    });
    expect(report.sessionRules).toBe(1);
    expect(report.defaultRules).toBe(0);
    expect(report.reviewRules).toBe(1);
    expect(report.policies).toBe(2);
  });

  test('a code reviewer from the session vendor seeds no review rule or policy', () => {
    w.s.db
      .update(agentTable)
      .set({ provider: 'claude-code', modelId: 'claude-sonnet-5-5' })
      .where(eq(agentTable.id, 'reviewer'))
      .run();
    const report = runRoutingMigration(w.s.db);
    expect(report.reviewRules).toBe(0);
    expect(
      w.s.db
        .select()
        .from(routingRule)
        .all()
        .map((r) => r.use),
    ).toEqual(['session']);
    expect(
      w.s.db
        .select()
        .from(workPolicy)
        .all()
        .map((p) => p.use),
    ).toEqual(['session']);
  });

  test('reports the secrets of the other agents without granting them', () => {
    const report = runRoutingMigration(w.s.db);
    expect(report.withheldSecrets.map((r) => r.agentId).sort()).toEqual([
      'docs',
      'reviewer',
      'verifier',
    ]);
    const granted = w.s.db
      .select()
      .from(workPolicy)
      .all()
      .flatMap((p) => p.secrets);
    expect(granted).toEqual(['SECRET_IMPL']);
    expect(JSON.stringify(report)).not.toContain('SECRET_DOCS');
  });

  test('a second run inserts nothing and reports nothing', () => {
    runRoutingMigration(w.s.db);
    const before = JSON.stringify([
      w.s.db.select().from(routingRule).all(),
      w.s.db.select().from(workPolicy).all(),
      w.s.db.select().from(agentMemory).all(),
    ]);
    const again = runRoutingMigration(w.s.db);
    expect(again).toEqual({
      sessionRules: 0,
      defaultRules: 0,
      reviewRules: 0,
      policies: 0,
      memoriesAdopted: 0,
      withheldSecrets: [],
    });
    expect(
      JSON.stringify([
        w.s.db.select().from(routingRule).all(),
        w.s.db.select().from(workPolicy).all(),
        w.s.db.select().from(agentMemory).all(),
      ]),
    ).toBe(before);
  });

  test('a rule edited after the first run survives the next boot', () => {
    runRoutingMigration(w.s.db);
    w.s.db
      .update(routingRule)
      .set({ modelId: 'edited' })
      .where(eq(routingRule.use, 'session'))
      .run();
    runRoutingMigration(w.s.db);
    expect(
      w.s.db.select().from(routingRule).where(eq(routingRule.use, 'session')).get()?.modelId,
    ).toBe('edited');
  });

  test('copies agent memories to the session rule and keeps the originals', () => {
    w.s.db
      .insert(agentMemory)
      .values({
        id: 'mem-1',
        agentId: 'impl',
        teamId: w.s.team.id,
        projectId: null,
        title: 'commits',
        content: 'prefer small commits',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const report = runRoutingMigration(w.s.db);
    expect(report.memoriesAdopted).toBe(1);
    const rule = w.s.db.select().from(routingRule).where(eq(routingRule.use, 'session')).get()!;
    const rows = w.s.db.select().from(agentMemory).all();
    expect(rows.find((r) => r.id === 'mem-1')?.agentId).toBe('impl');
    expect(rows.filter((r) => r.agentId === rule.id)).toHaveLength(1);
    expect(runRoutingMigration(w.s.db).memoriesAdopted).toBe(0);
  });

  test('rollback safety: the run changes no agent, todo, build, step or chief row', () => {
    legacyTodo(w, 'inflight');
    startLegacyBuild(w, 'inflight', true);
    const before = tableSnapshot(w);
    runRoutingMigration(w.s.db);
    expect(tableSnapshot(w)).toBe(before);
  });

  test('rollback safety: with the flag switched back off the legacy step claims on the agent', async () => {
    w.s.db
      .update(agentTable)
      .set({ provider: 'stub-gw', modelId: 'old-model' })
      .where(eq(agentTable.id, 'impl'))
      .run();
    legacyTodo(w, 'inflight');
    startLegacyBuild(w, 'inflight', false);
    runRoutingMigration(w.s.db);
    setRoutingRulesEnabled(false);
    const claimed = await claim(w);
    expect(claimed?.step.kind).toBe('build');
    expect(claimed?.agent?.id).toBe('impl');
  });
});

describe('in-flight legacy todos after the upgrade', () => {
  test('a queued legacy plan step still claims, on the rule model and the policy permissions', async () => {
    const w = await legacyWorld();
    seedLegacyAgents(w, true);
    legacyTodo(w, 'inflight');
    startLegacyBuild(w, 'inflight', true);
    runRoutingMigration(w.s.db);
    w.s.db
      .update(routingRule)
      .set({ modelId: 'rule-model' })
      .where(eq(routingRule.use, 'session'))
      .run();
    setRoutingRulesEnabled(true);
    const claimed = await claim(w);
    expect(claimed?.step.kind).toBe('plan');
    expect(claimed?.agent?.modelId).toBe('rule-model');
    expect(claimed?.agent?.id).toBe('impl');
  });

  test('a legacy build in review that is sent back continues on the legacy path', async () => {
    const w = await legacyWorld();
    seedLegacyAgents(w);
    legacyTodo(w, 'inflight');
    const buildId = startLegacyBuild(w, 'inflight', false);
    w.s.db.update(step).set({ status: 'done' }).where(eq(step.buildId, buildId)).run();
    w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, 'inflight')).run();
    runRoutingMigration(w.s.db);
    setRoutingRulesEnabled(true);
    expect(buildRunsSession(deps(w), buildId)).toBe(false);
    const res = await w.s.app.request(`/api/builds/${buildId}/steps`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'revision',
        side: 'plan',
        feedback: 'tighten the tests',
        clientMessageId: 'c-1',
      }),
    });
    expect(res.status).toBeLessThan(300);
    const kinds = w.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .map((r) => r.kind);
    expect(kinds).toContain('plan');
    expect(kinds).not.toContain('session');
  });

  test('a todo started after the upgrade runs one session step with no plan', async () => {
    const w = await legacyWorld();
    seedLegacyAgents(w);
    runRoutingMigration(w.s.db);
    setRoutingRulesEnabled(true);
    legacyTodo(w, 'fresh');
    const [started] = startBuilds(deps(w), {
      projectId: w.projectId,
      todoIds: ['fresh'],
      assignment: { plan: null, build: null },
      withPlan: true,
    });
    const kinds = w.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, started!.id))
      .all()
      .map((r) => r.kind);
    expect(kinds).toEqual(['session']);
    expect(w.s.db.select().from(build).where(eq(build.id, started!.id)).get()?.withPlan).toBe(
      false,
    );
  });
});

describe('a team with no agents', () => {
  test('gets a default session rule and a push-only policy, and a second run changes nothing', async () => {
    const w = await legacyWorld();
    const report = runRoutingMigration(w.s.db);
    expect(report.defaultRules).toBe(1);
    expect(report.sessionRules).toBe(0);
    expect(w.s.db.select().from(routingRule).get()).toMatchObject({
      use: 'session',
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      machineId: null,
      seededFromAgentId: null,
    });
    expect(w.s.db.select().from(workPolicy).get()).toMatchObject({
      use: 'session',
      tools: [...AGENT_TOOL_DEFAULTS],
      secrets: [],
      mcpServers: [],
    });
    expect(w.s.db.select().from(routingRule).all()).toHaveLength(1);
    expect(runRoutingMigration(w.s.db).defaultRules).toBe(0);
    expect(w.s.db.select().from(routingRule).all()).toHaveLength(1);
    expect(w.s.db.select().from(workPolicy).all()).toHaveLength(1);
  });

  test('agents without a model fall back to the default rule', async () => {
    const w = await legacyWorld();
    legacyAgent(w, 'blank', { persona: 'implementer', provider: null, modelId: null });
    expect(runRoutingMigration(w.s.db).defaultRules).toBe(1);
  });

  test('a session step is claimable with the default rule and carries no secrets', async () => {
    const w = await legacyWorld();
    runRoutingMigration(w.s.db);
    setRoutingRulesEnabled(true);
    legacyTodo(w, 'fresh');
    const [started] = startBuilds(deps(w), {
      projectId: w.projectId,
      todoIds: ['fresh'],
      assignment: { plan: null, build: null },
      withPlan: false,
    });
    const sessionStep = w.s.db.select().from(step).where(eq(step.buildId, started!.id)).get()!;
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, 'fresh')).get()!;
    expect(agentForStep(w.s.db, todoRow, 'session')).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      secrets: [],
    });
    expect(
      resolveStepCredentials({ db: w.s.db, box: w.s.secretBox }, sessionStep.id).secrets,
    ).toEqual({});
  });

  test('without any rule a session step names the missing routing rule', async () => {
    const w = await legacyWorld();
    legacyTodo(w, 'fresh');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, 'fresh')).get()!;
    expect(unassignedStepReason(todoRow, 'session', null)).toMatch(/session.*routing rule/i);
  });

  test('another team keeps its own rule', async () => {
    const w = await legacyWorld();
    const other = newRecordId();
    w.s.db
      .insert(teamTable)
      .values({ ...w.s.db.select().from(teamTable).get()!, id: other, name: 'other-team' })
      .run();
    runRoutingMigration(w.s.db);
    expect(
      w.s.db
        .select()
        .from(routingRule)
        .all()
        .map((r) => r.teamId)
        .sort(),
    ).toEqual([w.s.team.id, other].sort());
  });
});

describe('persona seeding is gone from boot', () => {
  test('index.ts no longer imports backfillPersonas', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8');
    expect(source).not.toContain('backfillPersonas');
    expect(source).toContain('runRoutingMigration');
  });
});
