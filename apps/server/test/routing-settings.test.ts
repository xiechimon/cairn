import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  type RoutingRuleRecord,
  type TeamRoutingSettings,
  type WorkPolicyRecord,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { bootServer, insertMachine, req } from './helpers.js';

describe('routing settings API (D60 PR8)', () => {
  test('GET returns empty rules and policies for a team with none configured', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/routing-settings`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TeamRoutingSettings;
    expect(body).toEqual({ rules: [], policies: [] });
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

  test('foreign team returns 404', async () => {
    const s = bootServer();
    expect((await req(s.app, 'GET', '/api/teams/other/routing-settings')).status).toBe(404);
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
