import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  machine as machineTable,
  routingRule,
  todo as todoTable,
  workPolicy,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { agentForStep } from '../src/services/dispatch-eligibility.js';
import {
  seedReviewRules,
  seedRoutingRules,
  setRoutingRulesEnabled,
} from '../src/services/routing-rules.js';
import { bootServer, issueApiKey, postProject, req, type TestServer } from './helpers.js';

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

async function world(): Promise<World> {
  const s = bootServer({ claimHoldMs: 50 });
  servers.push(s);
  const key = await issueApiKey(s);
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'rule-agent-mbp', cliVersion: '0.1.0' }),
  });
  const machineToken = ((await res.json()) as { token: string }).token;
  const machineId = s.db
    .select({ id: machineTable.id })
    .from(machineTable)
    .where(eq(machineTable.teamId, s.team.id))
    .get()!.id;
  s.db
    .update(machineTable)
    .set({ online: true, enabledRuntimes: ['pi'] })
    .where(eq(machineTable.id, machineId))
    .run();
  const projectId = await postProject(s.app, 'rule-agent-proj');
  return { s, machineToken, machineId, projectId };
}

function rule(
  w: World,
  use: 'session' | 'review',
  values: Partial<typeof routingRule.$inferInsert> = {},
) {
  const id = newRecordId();
  w.s.db
    .insert(routingRule)
    .values({
      id,
      teamId: w.s.team.id,
      use,
      provider: 'stub-gw',
      modelId: `${use}-model`,
      thinkingLevel: null,
      machineId: w.machineId,
      createdAt: 1,
      updatedAt: 1,
      ...values,
    })
    .run();
  return id;
}

async function startWithoutAgent(w: World): Promise<typeof todoTable.$inferSelect> {
  const todoRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
    title: 'no agent',
    spec: 'probe',
  });
  const todoId = ((await todoRes.json()) as { id: string }).id;
  const started = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: null, build: null },
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
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

describe('D71 a step with no assigned agent runs from the routing rule', () => {
  test('rules on: a build with an empty assignment gets an agent-shaped row from the session rule', async () => {
    const w = await world();
    const ruleId = rule(w, 'session');
    w.s.db
      .insert(workPolicy)
      .values({
        id: newRecordId(),
        teamId: w.s.team.id,
        use: 'session',
        tools: ['policy-tool'],
        mcpServers: [],
        secrets: [],
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const todoRow = await startWithoutAgent(w);
    expect(agentForStep(w.s.db, todoRow, 'build')).toMatchObject({
      id: ruleId,
      provider: 'stub-gw',
      modelId: 'session-model',
      machineId: w.machineId,
      tools: ['policy-tool'],
    });
  });

  test('rules on: the machine claims that build with the rule model', async () => {
    const w = await world();
    rule(w, 'session');
    await startWithoutAgent(w);
    const claimed = await claim(w);
    expect(claimed?.step.kind).toBe('session');
    expect(claimed?.agent?.modelId).toBe('session-model');
  });

  test('rules off: a build with an empty assignment still has no agent', async () => {
    const w = await world();
    rule(w, 'session');
    const todoRow = await startWithoutAgent(w);
    setRoutingRulesEnabled(false);
    expect(agentForStep(w.s.db, todoRow, 'build')).toBeNull();
  });

  test('rules on: a review step whose meta names the review rule runs on Codex', async () => {
    const w = await world();
    const reviewId = rule(w, 'review');
    const todoRow = await startWithoutAgent(w);
    const prompt = `${JSON.stringify({ kind: 'review', agentId: reviewId })}\nreview body`;
    expect(agentForStep(w.s.db, todoRow, 'review', prompt)).toMatchObject({
      id: reviewId,
      provider: 'openai-codex',
      modelId: 'gpt-6.1-sol',
    });
  });

  test('rules on: the review rule replaces an existing reviewer agent model with Codex', async () => {
    const w = await world();
    rule(w, 'review');
    w.s.db
      .insert(agentTable)
      .values({
        id: 'reviewer',
        teamId: w.s.team.id,
        displayName: 'reviewer',
        provider: 'stub-gw',
        modelId: 'agent-model',
      })
      .run();
    const todoRow = await startWithoutAgent(w);
    const prompt = `${JSON.stringify({ kind: 'review', agentId: 'reviewer' })}\nreview body`;
    expect(agentForStep(w.s.db, todoRow, 'review', prompt)).toMatchObject({
      provider: 'openai-codex',
      modelId: 'gpt-6.1-sol',
    });
  });

  test('seeding adds a review rule from the code reviewer', async () => {
    const w = await world();
    w.s.db.delete(agentTable).where(eq(agentTable.teamId, w.s.team.id)).run();
    w.s.db
      .insert(agentTable)
      .values({
        id: 'cr',
        teamId: w.s.team.id,
        displayName: 'CodeReviewer',
        persona: 'code_reviewer',
        provider: 'claude-code',
        modelId: 'claude-sonnet-5-5',
        machineId: w.machineId,
      })
      .run();
    expect(seedReviewRules(w.s.db)).toBe(1);
    expect(
      w.s.db.select().from(routingRule).where(eq(routingRule.use, 'review')).get(),
    ).toMatchObject({
      seededFromAgentId: 'cr',
      modelId: 'claude-sonnet-5-5',
      machineId: w.machineId,
    });
  });

  test('a session rule seeded before it carried constraints gets its seed agent constraints backfilled, Orb included', async () => {
    const w = await world();
    w.s.db
      .update(machineTable)
      .set({ name: 'omarchy-orb', capabilities: null })
      .where(eq(machineTable.id, w.machineId))
      .run();
    w.s.db
      .insert(agentTable)
      .values({
        id: 'impl',
        teamId: w.s.team.id,
        displayName: 'impl',
        persona: 'implementer',
        provider: 'stub-gw',
        modelId: 'm',
        machineId: w.machineId,
        requiredCapabilities: { mcpServers: ['figma'] },
      })
      .run();
    const ruleId = rule(w, 'session', { seededFromAgentId: 'impl', requiredCapabilities: null });
    seedRoutingRules(w.s.db);
    seedRoutingRules(w.s.db);
    expect(
      w.s.db.select().from(routingRule).where(eq(routingRule.id, ruleId)).get()
        ?.requiredCapabilities,
    ).toEqual({ mcpServers: ['figma'], executor: 'orb' });
  });

  test('backfill leaves a rule that already has constraints, and a rule with no seed agent, alone', async () => {
    const w = await world();
    const set = rule(w, 'session', {
      seededFromAgentId: 'missing-agent',
      requiredCapabilities: { mcpServers: ['context7'] },
    });
    seedRoutingRules(w.s.db);
    expect(
      w.s.db.select().from(routingRule).where(eq(routingRule.id, set)).get()?.requiredCapabilities,
    ).toEqual({ mcpServers: ['context7'] });
  });

  test('rules on: an agentless merge step runs from the session rule', async () => {
    const w = await world();
    const ruleId = rule(w, 'session');
    const todoRow = await startWithoutAgent(w);
    expect(agentForStep(w.s.db, todoRow, 'merge')?.id).toBe(ruleId);
  });
});
