import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  machine as machineTable,
  routingRule,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { agentForStep } from '../src/services/dispatch-eligibility.js';
import {
  applyRoute,
  seedRoutingRules,
  setRoutingRulesEnabled,
  withOverride,
} from '../src/services/routing-rules.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const AGENT_BUILD = 'agent-route-build';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});
beforeEach(() => setRoutingRulesEnabled(true));
afterEach(() => setRoutingRulesEnabled(false));

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
    body: JSON.stringify({ teamId: s.team.id, name: 'route-mbp', cliVersion: '0.1.0' }),
  });
  expect(res.status).toBe(200);
  const machineToken = ((await res.json()) as { token: string }).token;
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_BUILD,
      teamId: s.team.id,
      displayName: AGENT_BUILD,
      provider: 'agent-provider',
      modelId: 'agent-model',
      thinkingLevel: 'low',
    })
    .run();
  bindAllAgents(s);
  const machineId = s.db
    .select({ id: machineTable.id })
    .from(machineTable)
    .where(eq(machineTable.teamId, s.team.id))
    .get()!.id;
  const projectId = await postProject(s.app, 'route-proj');
  return { s, machineToken, machineId, projectId };
}

function insertRule(
  s: TestServer,
  values: Partial<typeof routingRule.$inferInsert> & { teamId: string },
): void {
  s.db
    .insert(routingRule)
    .values({
      id: newRecordId(),
      use: 'session',
      provider: 'rule-provider',
      modelId: 'rule-model',
      thinkingLevel: 'high',
      createdAt: 1,
      updatedAt: 1,
      ...values,
    })
    .run();
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
    assignment: { plan: null, build: { agentId: AGENT_BUILD } },
    withPlan: false,
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

describe('routeForStep: the session rule replaces the agent model and machine', () => {
  test('flag off: a session rule is ignored and the agent fields stand', async () => {
    const w = await setupWorld();
    insertRule(w.s, { teamId: w.s.team.id });
    const todoRow = await buildTodo(w);
    setRoutingRulesEnabled(false);
    const row = agentForStep(w.s.db, todoRow, 'build');
    expect(row?.modelId).toBe('agent-model');
    expect(row?.provider).toBe('agent-provider');
  });

  test('flag on: plan, build and verify steps take the rule model, thinking and fallbacks', async () => {
    const w = await setupWorld();
    insertRule(w.s, {
      teamId: w.s.team.id,
      fallbackModels: [{ provider: 'rule-provider', modelId: 'rule-fallback' }],
    });
    const todoRow = await buildTodo(w);
    for (const kind of ['plan', 'build', 'verify'] as const) {
      const row = agentForStep(
        w.s.db,
        {
          ...todoRow,
          assignment: {
            plan: { agentId: AGENT_BUILD },
            build: { agentId: AGENT_BUILD },
            verify: { agentId: AGENT_BUILD },
          },
        },
        kind,
      );
      expect(row?.id).toBe(AGENT_BUILD);
      expect(row?.provider).toBe('rule-provider');
      expect(row?.modelId).toBe('rule-model');
      expect(row?.thinkingLevel).toBe('high');
      expect(row?.fallbackModels).toEqual([
        { provider: 'rule-provider', modelId: 'rule-fallback' },
      ]);
      expect(row?.machineId).toBe(w.machineId);
    }
  });

  test('flag on: a rule machine replaces the home machine; a rule without one keeps it', async () => {
    const w = await setupWorld();
    const otherMachine = newRecordId();
    w.s.db
      .insert(machineTable)
      .values({
        id: otherMachine,
        teamId: w.s.team.id,
        name: 'route-other',
        tokenHash: 'x'.repeat(64),
        createdAt: 1,
      } as typeof machineTable.$inferInsert)
      .run();
    insertRule(w.s, { teamId: w.s.team.id, machineId: otherMachine });
    const todoRow = await buildTodo(w);
    expect(agentForStep(w.s.db, todoRow, 'build')?.machineId).toBe(otherMachine);
    w.s.db.update(routingRule).set({ machineId: null }).run();
    expect(agentForStep(w.s.db, todoRow, 'build')?.machineId).toBe(w.machineId);
  });

  test('flag on: review steps and other teams are not routed by the session rule', async () => {
    const w = await setupWorld();
    const otherTeam = newRecordId();
    w.s.db
      .insert(teamTable)
      .values({ ...w.s.db.select().from(teamTable).get()!, id: otherTeam, name: 'other-team' })
      .run();
    insertRule(w.s, { teamId: otherTeam });
    const todoRow = await buildTodo(w);
    expect(agentForStep(w.s.db, todoRow, 'build')?.modelId).toBe('agent-model');
    insertRule(w.s, { teamId: w.s.team.id });
    const prompt = `${JSON.stringify({ kind: 'review', agentId: AGENT_BUILD })}\nreview body`;
    expect(agentForStep(w.s.db, todoRow, 'build')?.modelId).toBe('rule-model');
    expect(agentForStep(w.s.db, todoRow, 'review', prompt)?.modelId).toBe('agent-model');
  });

  test('flag on: the claimed build step carries the rule model to the daemon', async () => {
    const w = await setupWorld();
    insertRule(w.s, { teamId: w.s.team.id });
    await buildTodo(w);
    const claimed = await claim(w);
    expect(claimed?.step.kind).toBe('build');
    expect(claimed?.agent?.modelId).toBe('rule-model');
    expect(claimed?.agent?.provider).toBe('rule-provider');
  });

  test('deleting the rule machine clears the rule machine instead of failing on the foreign key', async () => {
    const w = await setupWorld();
    const spare = newRecordId();
    w.s.db
      .insert(machineTable)
      .values({
        id: spare,
        teamId: w.s.team.id,
        name: 'route-spare',
        tokenHash: 'y'.repeat(64),
        createdAt: 1,
      } as typeof machineTable.$inferInsert)
      .run();
    insertRule(w.s, { teamId: w.s.team.id, machineId: spare });
    const res = await req(w.s.app, 'DELETE', `/api/machines/${spare}`);
    expect(res.status).toBe(204);
    expect(w.s.db.select().from(routingRule).get()?.machineId).toBeNull();
  });
});

describe('seedRoutingRules: one session rule per team from its agents', () => {
  test('the implementer seeds the rule, and a second run changes nothing', async () => {
    const w = await setupWorld();
    w.s.db.delete(agentTable).where(eq(agentTable.persona, 'implementer')).run();
    w.s.db
      .insert(agentTable)
      .values({
        id: 'agent-impl',
        teamId: w.s.team.id,
        displayName: 'impl',
        persona: 'implementer',
        provider: 'claude-code',
        modelId: 'claude-sonnet-5-5',
        machineId: w.machineId,
      })
      .run();
    expect(seedRoutingRules(w.s.db)).toBe(1);
    const rule = w.s.db.select().from(routingRule).get()!;
    expect(rule).toMatchObject({
      teamId: w.s.team.id,
      use: 'session',
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      machineId: w.machineId,
      seededFromAgentId: 'agent-impl',
    });
    w.s.db.update(routingRule).set({ modelId: 'edited' }).run();
    expect(seedRoutingRules(w.s.db)).toBe(0);
    expect(w.s.db.select().from(routingRule).get()?.modelId).toBe('edited');
  });

  test('without an implementer the most-assigned build agent seeds the rule', async () => {
    const w = await setupWorld();
    w.s.db.delete(agentTable).where(eq(agentTable.persona, 'implementer')).run();
    await buildTodo(w);
    await buildTodo(w);
    expect(seedRoutingRules(w.s.db)).toBe(1);
    expect(w.s.db.select().from(routingRule).get()).toMatchObject({
      seededFromAgentId: AGENT_BUILD,
      modelId: 'agent-model',
    });
  });

  test('a team with no agent that has a model gets no rule', async () => {
    const w = await setupWorld();
    w.s.db.update(agentTable).set({ modelId: null }).run();
    expect(seedRoutingRules(w.s.db)).toBe(0);
    expect(w.s.db.select().from(routingRule).all()).toEqual([]);
  });
});

describe('D71 the session rule carries the hard constraints', () => {
  test('flag on: the rule constraints replace the agent constraints', async () => {
    const w = await setupWorld();
    w.s.db
      .update(agentTable)
      .set({ requiredCapabilities: { mcpServers: ['figma'] } })
      .where(eq(agentTable.id, AGENT_BUILD))
      .run();
    insertRule(w.s, { teamId: w.s.team.id, requiredCapabilities: { executor: 'orb' } });
    const todoRow = await buildTodo(w);
    expect(agentForStep(w.s.db, todoRow, 'build')?.requiredCapabilities).toEqual({
      executor: 'orb',
    });
  });

  test('flag on: a rule without constraints requires nothing even when the agent did', async () => {
    const w = await setupWorld();
    w.s.db
      .update(agentTable)
      .set({ requiredCapabilities: { executor: 'orb' } })
      .where(eq(agentTable.id, AGENT_BUILD))
      .run();
    insertRule(w.s, { teamId: w.s.team.id });
    const todoRow = await buildTodo(w);
    expect(agentForStep(w.s.db, todoRow, 'build')?.requiredCapabilities ?? null).toBeNull();
  });

  test('flag off: the agent constraints stand', async () => {
    const w = await setupWorld();
    setRoutingRulesEnabled(false);
    w.s.db
      .update(agentTable)
      .set({ requiredCapabilities: { executor: 'orb' } })
      .where(eq(agentTable.id, AGENT_BUILD))
      .run();
    insertRule(w.s, { teamId: w.s.team.id });
    const todoRow = await buildTodo(w);
    expect(agentForStep(w.s.db, todoRow, 'build')?.requiredCapabilities).toEqual({
      executor: 'orb',
    });
  });

  async function seedFrom(
    w: World,
    machine: { name: string; capabilities: unknown },
    required: { mcpServers?: string[] } | null = null,
  ) {
    w.s.db.delete(agentTable).where(eq(agentTable.persona, 'implementer')).run();
    w.s.db
      .update(machineTable)
      .set({ name: machine.name, capabilities: machine.capabilities as never })
      .where(eq(machineTable.id, w.machineId))
      .run();
    w.s.db
      .insert(agentTable)
      .values({
        id: 'agent-impl',
        teamId: w.s.team.id,
        displayName: 'impl',
        persona: 'implementer',
        provider: 'claude-code',
        modelId: 'claude-sonnet-5-5',
        machineId: w.machineId,
        requiredCapabilities: required,
      })
      .run();
    expect(seedRoutingRules(w.s.db)).toBe(1);
    return w.s.db.select().from(routingRule).get()!.requiredCapabilities;
  }

  test('seed: an implementer on a machine that reports executor orb gives an Orb-required rule', async () => {
    const w = await setupWorld();
    expect(
      await seedFrom(w, {
        name: 'sandbox',
        capabilities: { mcpServers: [], skills: [], executor: 'orb' },
      }),
    ).toEqual({ executor: 'orb' });
  });

  test('seed: an implementer on an -orb machine that never reported its executor is treated as Orb', async () => {
    const w = await setupWorld();
    expect(await seedFrom(w, { name: 'omarchy-orb', capabilities: null })).toEqual({
      executor: 'orb',
    });
  });

  test('seed: an implementer on a host keeps its own constraints and gains no Orb requirement', async () => {
    const w = await setupWorld();
    expect(
      await seedFrom(
        w,
        { name: 'mac', capabilities: { mcpServers: [], skills: [], executor: 'host' } },
        { mcpServers: ['figma'] },
      ),
    ).toEqual({ mcpServers: ['figma'] });
  });

  test('the coordinator rule does not touch the bound agent constraints (chief path unchanged)', async () => {
    const w = await setupWorld();
    const agentRow = {
      ...w.s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_BUILD)).get()!,
      requiredCapabilities: { mcpServers: ['figma'] },
    };
    const rule = {
      id: 'r',
      teamId: w.s.team.id,
      use: 'coordinator' as const,
      provider: 'p',
      modelId: 'm',
      thinkingLevel: null,
      fallbackModels: null,
      machineId: null,
      requiredCapabilities: { executor: 'orb' as const },
      seededFromAgentId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(applyRoute(agentRow, rule).requiredCapabilities).toEqual({ mcpServers: ['figma'] });
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
      assignment: { plan: null, build: { agentId: AGENT_BUILD } },
      withPlan: false,
      routeOverride,
    });
    return { res, todoId };
  }

  test('the override is stored on the task with the dispatch and read by the route', async () => {
    const w = await setupWorld();
    insertRule(w.s, { teamId: w.s.team.id, requiredCapabilities: { executor: 'orb' } });
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
    expect(agentForStep(w.s.db, todoRow, 'build')?.requiredCapabilities).toEqual({
      mcpServers: ['figma'],
      executor: 'orb',
    });
  });

  test('an override naming a machine outside the team is refused', async () => {
    const w = await setupWorld();
    const { res } = await start(w, { machineId: newRecordId() });
    expect(res.status).toBe(404);
  });
});
