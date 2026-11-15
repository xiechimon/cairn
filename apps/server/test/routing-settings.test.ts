import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  type RoutingRuleRecord,
  type TeamRoutingSettings,
  type WorkPolicyRecord,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, onTestFinished, test } from 'vitest';
import { machine as machineTable, routingRule, team as teamTable } from '../src/db/schema.js';
import { setCoordinatorServerContextEnabled } from '../src/services/coordinator-context.js';
import { createProvider } from '../src/services/providers.js';
import {
  bootServer,
  insertMachine,
  req,
  seedRoute,
  subscriptionClaudeReport,
  type TestServer,
} from './helpers.js';

describe('routing settings API (D60 PR8)', () => {
  test('GET returns empty rules and policies for a team with none configured', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/routing-settings`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TeamRoutingSettings;
    expect(body).toEqual({
      rules: [],
      policies: [],
      sessionDefault: { reason: 'none', provider: null, modelId: null },
      ruleIssues: [],
    });
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

function addProvider(
  s: TestServer,
  providerId: string,
  opts: {
    baseUrl?: string;
    api?: 'openai-completions' | 'anthropic-messages';
    key?: boolean;
    models?: string[];
  } = {},
) {
  createProvider(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      body: {
        providerId,
        label: providerId,
        baseUrl: opts.baseUrl ?? `https://${providerId}.example.com/v1`,
        api: opts.api ?? 'openai-completions',
        ...(opts.key === false ? {} : { apiKey: `${providerId}-key` }),
        models: (opts.models ?? ['glm-5.3']).map((id) => ({ id, name: id })),
      },
      createdBy: s.user.id,
    },
  );
}

async function settings(s: TestServer): Promise<TeamRoutingSettings> {
  return (await (
    await req(s.app, 'GET', `/api/teams/${s.team.id}/routing-settings`)
  ).json()) as TeamRoutingSettings;
}

function ruleRow(s: TestServer, use: 'session' | 'coordinator' | 'citation_check') {
  return s.db.select().from(routingRule).where(eq(routingRule.use, use)).get();
}

function readAtEpoch(s: TestServer) {
  s.db.update(routingRule).set({ updatedAt: 1 }).run();
}

describe('routing rule issues and the one-click fix', () => {
  test('runtime-disabled: the fix moves to the default and clears the old pin, fallback and thinking', async () => {
    const s = bootServer();
    const machineId = insertMachine(s);
    addProvider(s, 'vani');
    seedRoute(s, 'session', {
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      machineId,
      thinkingLevel: 'high',
      fallbackModels: [{ provider: 'claude-code', modelId: 'claude-haiku-5-5' }],
    });
    readAtEpoch(s);
    const before = ruleRow(s, 'session')!;
    const { ruleIssues } = await settings(s);
    expect(ruleIssues).toEqual([
      {
        use: 'session',
        reason: 'runtime-disabled',
        runtime: 'claude-code',
        suggested: {
          provider: 'vani',
          modelId: 'glm-5.3',
          machineId: null,
          fallbackModels: null,
          thinkingLevel: null,
          expectedUpdatedAt: before.updatedAt,
        },
      },
    ]);
    expect(ruleRow(s, 'session')).toEqual(before);
    const fix = ruleIssues![0]!.suggested!;
    const applied = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/routing-rules/session`, fix);
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({
      id: before.id,
      provider: 'vani',
      modelId: 'glm-5.3',
      machineId: null,
      fallbackModels: null,
      thinkingLevel: null,
    });
    expect((await settings(s)).ruleIssues).toEqual([]);
    const fixed = ruleRow(s, 'session')!;
    const again = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/routing-rules/session`, {
      ...fix,
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
    expect(again.status).toBe(409);
    expect(ruleRow(s, 'session')).toEqual(fixed);
  });

  test('a Runner that goes offline raises no issue; only what it can run counts', async () => {
    const s = bootServer();
    const machineId = insertMachine(s, { claudeCodeReport: subscriptionClaudeReport });
    s.db.update(machineTable).set({ online: false }).run();
    seedRoute(s, 'session', { provider: 'claude-code', modelId: 'claude-sonnet-5-5', machineId });
    expect((await settings(s)).ruleIssues).toEqual([]);
  });

  test('machine-unusable: a pin to a Runner without the runtime is flagged, and deleting the Runner makes an open fix stale', async () => {
    const s = bootServer();
    insertMachine(s, { name: 'cc', claudeCodeReport: subscriptionClaudeReport });
    const piOnly = insertMachine(s, { name: 'pi-only' });
    seedRoute(s, 'session', {
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      machineId: piOnly,
    });
    readAtEpoch(s);
    const [issue] = (await settings(s)).ruleIssues!;
    expect(issue).toMatchObject({
      use: 'session',
      reason: 'machine-unusable',
      machineId: piOnly,
      suggested: { provider: 'claude-code', modelId: 'claude-sonnet-5-5', machineId: null },
    });
    expect((await req(s.app, 'DELETE', `/api/machines/${piOnly}`)).status).toBe(204);
    const afterDelete = ruleRow(s, 'session')!;
    expect(afterDelete.machineId).toBeNull();
    const stale = await req(
      s.app,
      'PATCH',
      `/api/teams/${s.team.id}/routing-rules/session`,
      issue!.suggested,
    );
    expect(stale.status).toBe(409);
    expect(ruleRow(s, 'session')).toEqual(afterDelete);
  });

  test('provider-missing and provider-no-key name the provider; a keyless custom endpoint is fine', async () => {
    const s = bootServer();
    insertMachine(s);
    seedRoute(s, 'session', { provider: 'gone', modelId: 'glm-5.3' });
    expect((await settings(s)).ruleIssues).toMatchObject([
      { use: 'session', reason: 'provider-missing', provider: 'gone', suggested: null },
    ]);
    addProvider(s, 'anthropic', {
      baseUrl: 'https://api.anthropic.com',
      api: 'anthropic-messages',
      key: false,
      models: ['claude-haiku-5-5'],
    });
    seedRoute(s, 'session', { provider: 'anthropic', modelId: 'claude-haiku-5-5' });
    expect((await settings(s)).ruleIssues).toMatchObject([
      { use: 'session', reason: 'provider-no-key', provider: 'anthropic' },
    ]);
    addProvider(s, 'my-gateway', { key: false });
    seedRoute(s, 'session', { provider: 'my-gateway', modelId: 'glm-5.3' });
    expect((await settings(s)).ruleIssues).toEqual([]);
  });

  test('a Codex rule with no provider row runs on a Runner Codex login and is flagged only without one', async () => {
    const s = bootServer();
    const machineId = insertMachine(s);
    seedRoute(s, 'session', { provider: 'openai-codex', modelId: 'gpt-6.1-sol' });
    expect((await settings(s)).ruleIssues).toMatchObject([
      { use: 'session', reason: 'runtime-disabled', runtime: 'pi' },
    ]);
    const row = s.db.select().from(machineTable).where(eq(machineTable.id, machineId)).get()!;
    s.db
      .update(machineTable)
      .set({ capabilities: { ...row.capabilities!, codexLogin: { state: 'ok' } } })
      .where(eq(machineTable.id, machineId))
      .run();
    expect((await settings(s)).ruleIssues).toEqual([]);
  });

  test('a capability-routed Session rule is not flagged while the Runner can run Claude Code or Codex', async () => {
    const s = bootServer();
    const machineId = insertMachine(s);
    const row = s.db.select().from(machineTable).where(eq(machineTable.id, machineId)).get()!;
    s.db
      .update(machineTable)
      .set({ capabilities: { ...row.capabilities!, codexLogin: { state: 'ok' } } })
      .where(eq(machineTable.id, machineId))
      .run();
    seedRoute(s, 'session', { provider: 'claude-code', modelId: 'claude-sonnet-5-5', machineId });
    expect((await settings(s)).ruleIssues).toEqual([]);
    s.db
      .update(machineTable)
      .set({ capabilities: row.capabilities, claudeCodeReport: subscriptionClaudeReport })
      .where(eq(machineTable.id, machineId))
      .run();
    seedRoute(s, 'session', { provider: 'openai-codex', modelId: 'gpt-6.1-sol', machineId });
    expect((await settings(s)).ruleIssues).toEqual([]);
    seedRoute(s, 'review', { provider: 'openai-codex', modelId: 'gpt-6.1-sol' });
    expect((await settings(s)).ruleIssues).toMatchObject([
      { use: 'review', reason: 'provider-missing', provider: 'openai-codex' },
    ]);
  });

  test('paid-claude: a keyed Claude rule is flagged until the team allows paid Claude', async () => {
    const s = bootServer();
    insertMachine(s);
    addProvider(s, 'anthropic', {
      baseUrl: 'https://api.anthropic.com',
      api: 'anthropic-messages',
      models: ['claude-haiku-5-5'],
    });
    seedRoute(s, 'session', { provider: 'anthropic', modelId: 'claude-haiku-5-5' });
    expect((await settings(s)).ruleIssues).toMatchObject([
      { use: 'session', reason: 'paid-claude', provider: 'anthropic', suggested: null },
    ]);
    s.db
      .update(teamTable)
      .set({ claudeUsage: 'allow-paid' })
      .where(eq(teamTable.id, s.team.id))
      .run();
    expect((await settings(s)).ruleIssues).toEqual([]);
  });

  test('coordinator in-server: the issue comes from the route verdict and the fix is the Coordinator default', async () => {
    const s = bootServer();
    setCoordinatorServerContextEnabled(true);
    onTestFinished(() => setCoordinatorServerContextEnabled(false));
    addProvider(s, 'vani');
    seedRoute(s, 'coordinator', { provider: 'gone', modelId: 'glm-5.3' });
    const before = ruleRow(s, 'coordinator')!;
    expect((await settings(s)).ruleIssues).toEqual([
      {
        use: 'coordinator',
        reason: 'provider-missing',
        provider: 'gone',
        suggested: { provider: 'vani', modelId: 'glm-5.3', expectedUpdatedAt: before.updatedAt },
      },
    ]);
  });

  test('a healthy citation_check rule on a relay provider is not flagged and reads back byte-identical', async () => {
    const s = bootServer();
    insertMachine(s);
    addProvider(s, 'relay-186');
    seedRoute(s, 'citation_check', { provider: 'relay-186', modelId: 'glm-5.3' });
    const before = ruleRow(s, 'citation_check')!;
    expect((await settings(s)).ruleIssues).toEqual([]);
    expect(ruleRow(s, 'citation_check')).toEqual(before);
  });
});
