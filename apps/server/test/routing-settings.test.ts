import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  type RoutingRuleRecord,
  type TeamRoutingSettings,
  type WorkPolicyRecord,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { agent as agentTable, routingRule } from '../src/db/schema.js';
import { setRoutingRulesEnabled } from '../src/services/routing-rules.js';
import { bindAllAgents, bootServer, insertMachine, req } from './helpers.js';

beforeEach(() => setRoutingRulesEnabled(false));
afterEach(() => setRoutingRulesEnabled(false));

describe('routing settings API (D60 PR8)', () => {
  test('GET returns empty rules with the flag off by default', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/routing-settings`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TeamRoutingSettings;
    expect(body).toEqual({ enabled: false, rules: [], policies: [] });
  });

  test('GET reports enabled true when the flag is on, without flipping the default', async () => {
    const s = bootServer();
    setRoutingRulesEnabled(true);
    const body = (await (
      await req(s.app, 'GET', `/api/teams/${s.team.id}/routing-settings`)
    ).json()) as TeamRoutingSettings;
    expect(body.enabled).toBe(true);
    expect(body.rules).toEqual([]);
  });

  test('PATCH creates a session rule and a later PATCH updates it', async () => {
    const s = bootServer();
    const machineId = insertMachine(s);
    const created = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/routing-rules/session`, {
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      thinkingLevel: 'high',
      machineId,
    });
    expect(created.status).toBe(200);
    const rule = (await created.json()) as RoutingRuleRecord;
    expect(rule).toMatchObject({
      teamId: s.team.id,
      use: 'session',
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      thinkingLevel: 'high',
      machineId,
      seededFromAgentId: null,
    });
    const updated = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/routing-rules/session`, {
      modelId: 'claude-opus-5-5',
      machineId: null,
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      id: rule.id,
      modelId: 'claude-opus-5-5',
      machineId: null,
      thinkingLevel: 'high',
    });
  });

  test('PATCH refuses a create without provider/modelId and a foreign machine', async () => {
    const s = bootServer();
    const empty = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/routing-rules/session`, {
      thinkingLevel: 'low',
    });
    expect(empty.status).toBe(400);
    const missingMachine = await req(
      s.app,
      'PATCH',
      `/api/teams/${s.team.id}/routing-rules/session`,
      {
        provider: 'claude-code',
        modelId: 'claude-sonnet-5-5',
        machineId: 'no-such-machine',
      },
    );
    expect(missingMachine.status).toBe(404);
  });

  test('PATCH upserts a work policy and filters unknown tools', async () => {
    const s = bootServer();
    const created = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/work-policies/session`, {
      tools: [AGENT_TOOL_PUSH, 'not-a-tool', AGENT_TOOL_MERGE],
      mcpServers: ['github'],
      secrets: ['OPENAI_API_KEY'],
    });
    expect(created.status).toBe(200);
    const policy = (await created.json()) as WorkPolicyRecord;
    expect(policy).toMatchObject({
      teamId: s.team.id,
      use: 'session',
      tools: [AGENT_TOOL_PUSH, AGENT_TOOL_MERGE],
      mcpServers: ['github'],
      secrets: ['OPENAI_API_KEY'],
    });
    const updated = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/work-policies/session`, {
      tools: [AGENT_TOOL_PUSH],
    });
    expect((await updated.json()) as WorkPolicyRecord).toMatchObject({
      id: policy.id,
      tools: [AGENT_TOOL_PUSH],
      mcpServers: ['github'],
    });
  });

  test('seed creates session and review rows from agents without enabling the flag', async () => {
    const s = bootServer();
    const machineId = insertMachine(s);
    s.db
      .insert(agentTable)
      .values({
        id: 'agent-impl',
        teamId: s.team.id,
        displayName: 'impl',
        persona: 'implementer',
        provider: 'claude-code',
        modelId: 'claude-sonnet-5-5',
        machineId,
        tools: [AGENT_TOOL_PUSH],
        secrets: [],
        mcpServers: [],
      })
      .run();
    s.db
      .insert(agentTable)
      .values({
        id: 'agent-review',
        teamId: s.team.id,
        displayName: 'reviewer',
        persona: 'code_reviewer',
        provider: 'openai',
        modelId: 'gpt-5.4',
        machineId,
        tools: [AGENT_TOOL_PUSH, AGENT_TOOL_MERGE],
        secrets: ['X'],
        mcpServers: [],
      })
      .run();
    bindAllAgents(s);
    const seeded = await req(s.app, 'POST', `/api/teams/${s.team.id}/routing-settings/seed`);
    expect(seeded.status).toBe(200);
    const body = (await seeded.json()) as TeamRoutingSettings;
    expect(body.enabled).toBe(false);
    expect(body.rules.map((r) => r.use).sort()).toEqual(['review', 'session']);
    expect(body.policies.map((p) => p.use).sort()).toEqual(['review', 'session']);
    expect(body.rules.find((r) => r.use === 'session')).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      seededFromAgentId: 'agent-impl',
    });
    expect(body.policies.find((p) => p.use === 'review')?.secrets).toEqual([]);
    expect(body.policies.find((p) => p.use === 'review')?.tools).not.toContain(AGENT_TOOL_MERGE);
    expect(
      s.db.select().from(routingRule).where(eq(routingRule.teamId, s.team.id)).all(),
    ).toHaveLength(2);
  });

  test('foreign team returns 404', async () => {
    const s = bootServer();
    expect((await req(s.app, 'GET', '/api/teams/other/routing-settings')).status).toBe(404);
    expect((await req(s.app, 'POST', '/api/teams/other/routing-settings/seed')).status).toBe(404);
    expect(
      (
        await req(s.app, 'PATCH', '/api/teams/other/routing-rules/session', {
          provider: 'x',
          modelId: 'y',
        })
      ).status,
    ).toBe(404);
  });
});
