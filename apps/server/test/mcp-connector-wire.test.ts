import { type ClaudeCodeReport, machineTokenResponseSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, onTestFinished, test } from 'vitest';
import {
  chiefMessage as chiefMessageTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  mcpConnector,
  step as stepTable,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { executeRelayToolCall } from '../src/services/machine-relay.js';
import { claimStep, stepToken } from '../src/services/machines.js';
import {
  bootServer,
  enrollConnectorRunner,
  insertClaudeSubscription,
  insertMachine,
  postProject,
  queueConnectorStep,
  seedRoute,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

async function world() {
  const s = bootServer({ claimHoldMs: 100 });
  insertClaudeSubscription(s);
  onTestFinished(() => s.dispose());
  const projectId = await postProject(s.app, 'mcp-wire-proj');
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model' });
  return { s, projectId };
}

function connector(
  s: TestServer,
  slug: string,
  opts: { headers?: Record<string, string>; status?: 'connected' | 'needs_auth' } = {},
) {
  const headers = opts.headers ?? {};
  s.db
    .insert(mcpConnector)
    .values({
      id: newRecordId(),
      teamId: s.team.id,
      slug,
      label: slug,
      catalogId: null,
      url: `https://${slug}.example/mcp?k=1`,
      headerNames: Object.keys(headers),
      valuesCipher:
        Object.keys(headers).length > 0 ? s.secretBox.seal(JSON.stringify(headers)) : null,
      authKind: Object.keys(headers).length > 0 ? 'static' : 'none',
      oauthMeta: null,
      oauthCipher: null,
      status: opts.status ?? 'connected',
      statusReason: null,
      toolCount: 1,
      checkedAt: 1,
      authRevision: 1,
      tokenGeneration: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
}

function claim(s: TestServer, machineId: string) {
  return claimStep(
    {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
    },
    machineId,
    s.team.id,
    10,
    'http://localhost',
  );
}

async function tokenOf(s: TestServer, machineToken: string, stepId: string) {
  const res = await s.app.request(`/api/machine/token/${stepId}`, {
    headers: { authorization: `Bearer ${machineToken}` },
  });
  expect(res.status).toBe(200);
  return machineTokenResponseSchema.parse(await res.json());
}

describe('MCP connectors on the machine wire', () => {
  test('a Runner without connector support runs the step with its own local servers only, even one named like a connector', async () => {
    const { s, projectId } = await world();
    connector(s, 'linear', { headers: { Authorization: 'Bearer lin-static-token' } });
    const old = await enrollConnectorRunner(s, 'old-runner', false, ['files', 'Linear']);
    const stepId = queueConnectorStep(s, projectId, old.machineId);
    const claimed = await claim(s, old.machineId);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.mcpServers).toEqual(['files', 'linear']);
    const token = await tokenOf(s, old.token, stepId);
    expect(token.mcpConnectors).toBeUndefined();
    expect(token.withheldMcp).toBeUndefined();
  });

  test('a Runner with connector support gets every connector and its local servers without any grant', async () => {
    const { s, projectId } = await world();
    connector(s, 'linear', { headers: { Authorization: 'Bearer lin-static-token' } });
    connector(s, 'notion', { status: 'needs_auth' });
    const current = await enrollConnectorRunner(s, 'new-runner', true, ['files', 'Linear']);
    const stepId = queueConnectorStep(s, projectId, current.machineId);
    const claimed = await claim(s, current.machineId);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.mcpServers).toEqual(['files', 'linear', 'notion']);
    const token = await tokenOf(s, current.token, stepId);
    expect(token.mcpConnectors).toEqual([
      {
        slug: 'linear',
        transport: 'http',
        url: 'https://linear.example/mcp?k=1',
        headers: { Authorization: 'Bearer lin-static-token' },
      },
    ]);
    expect(token.withheldMcp).toEqual(['notion']);
  });

  test('a connector added between claim and token is not delivered to the Runner', async () => {
    const { s, projectId } = await world();
    connector(s, 'linear', { headers: { Authorization: 'Bearer lin-static-token' } });
    const runner = await enrollConnectorRunner(s, 'new-runner', true, ['files']);
    const stepId = queueConnectorStep(s, projectId, runner.machineId);
    const claimed = await claim(s, runner.machineId);
    expect(claimed?.mcpServers).toEqual(['files', 'linear']);
    connector(s, 'notion', { headers: { Authorization: 'Bearer notion-token' } });
    const token = await tokenOf(s, runner.token, stepId);
    expect(token.mcpConnectors?.map((c) => c.slug)).toEqual(['linear']);
    expect(token.withheldMcp).toBeUndefined();
  });

  test('a re-claimed step gets its new claim’s grant', async () => {
    const { s, projectId } = await world();
    connector(s, 'linear', { headers: { Authorization: 'Bearer lin-static-token' } });
    const runner = await enrollConnectorRunner(s, 'new-runner', true, ['files']);
    const stepId = queueConnectorStep(s, projectId, runner.machineId);
    await claim(s, runner.machineId);
    s.db
      .update(stepTable)
      .set({ status: 'pending', machineId: null })
      .where(eq(stepTable.id, stepId))
      .run();
    connector(s, 'notion', { headers: { Authorization: 'Bearer notion-token' } });
    const reclaimed = await claim(s, runner.machineId);
    expect(reclaimed?.step.id).toBe(stepId);
    const token = await tokenOf(s, runner.token, stepId);
    expect(token.mcpConnectors?.map((c) => c.slug)).toEqual(['linear', 'notion']);
  });

  test('a claimed step with no recorded grant gets no connectors', async () => {
    const { s, projectId } = await world();
    connector(s, 'linear', { headers: { Authorization: 'Bearer lin-static-token' } });
    const runner = await enrollConnectorRunner(s, 'new-runner', true, ['files']);
    const stepId = queueConnectorStep(s, projectId, runner.machineId);
    await claim(s, runner.machineId);
    s.db.update(stepTable).set({ mcpGrant: null }).where(eq(stepTable.id, stepId)).run();
    const token = await tokenOf(s, runner.token, stepId);
    expect(token.mcpConnectors).toBeUndefined();
    expect(token.withheldMcp).toBeUndefined();
  });
});

const THREAD = 'chief-mcp-thread';

function coordinatorWorld(connectors: boolean) {
  setCoordinatorInServer(true);
  onTestFinished(() => setCoordinatorInServer(false));
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  insertClaudeSubscription(s);
  onTestFinished(() => s.dispose());
  const report = {
    installed: true,
    hostname: 'omarchy',
    models: [{ id: 'sonnet', name: 'sonnet' }],
    auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
  } as ClaudeCodeReport;
  const machineId = insertMachine(s, { name: 'omarchy', claudeCodeReport: report });
  s.db
    .update(machineTable)
    .set({
      latestCliVersion: '0.3.0',
      capabilities: {
        mcpServers: ['files'],
        skills: [],
        ...(connectors ? { mcpConnectors: true as const } : {}),
      },
    })
    .where(eq(machineTable.id, machineId))
    .run();
  seedRoute(s, 'coordinator', {
    provider: 'claude-code',
    modelId: 'sonnet',
    thinkingLevel: 'off',
    machineId,
  });
  connector(s, 'linear', { headers: { Authorization: 'Bearer lin-static-token' } });
  s.db
    .insert(chiefTable)
    .values({ id: 'c1', userId: s.svc.user.id, teamId: s.team.id, createdAt: 1 })
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: THREAD,
      chiefId: 'c1',
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: 'x',
      createdAt: 2,
      updatedAt: 2,
      sessionId: '',
      sessionOpenedAt: 2,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({ id: 's1', buildId: THREAD, kind: 'chief', status: 'pending', createdAt: 3 })
    .run();
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
  return { s, machineId, deps };
}

describe('MCP connectors for the Coordinator on a Runner', () => {
  test('a Runner with connector support gets the connector on the claim and in the token', async () => {
    const { machineId, deps, s } = coordinatorWorld(true);
    const claimed = await claimStep(deps, machineId, s.team.id, 10, 'http://localhost');
    expect(claimed?.mcpServers).toEqual(['files', 'linear']);
    const token = await stepToken(deps, machineId, 's1');
    expect(token.mcpConnectors?.map((c) => c.slug)).toEqual(['linear']);
  });

  test('an older Runner runs the turn with its local servers and no connector or notice', async () => {
    const { machineId, deps, s } = coordinatorWorld(false);
    const claimed = await claimStep(deps, machineId, s.team.id, 10, 'http://localhost');
    expect(claimed?.step.id).toBe('s1');
    expect(claimed?.mcpServers).toEqual(['files']);
    expect((await stepToken(deps, machineId, 's1')).mcpConnectors).toBeUndefined();
    expect(
      s.db.select().from(chiefMessageTable).where(eq(chiefMessageTable.threadId, THREAD)).all(),
    ).toEqual([]);
  });

  test('a connector added between claim and token is not delivered for a Coordinator turn', async () => {
    const { machineId, deps, s } = coordinatorWorld(true);
    await claimStep(deps, machineId, s.team.id, 10, 'http://localhost');
    connector(s, 'notion', { headers: { Authorization: 'Bearer notion-token' } });
    const token = await stepToken(deps, machineId, 's1');
    expect(token.mcpConnectors?.map((c) => c.slug)).toEqual(['linear']);
  });

  test('a claimed chief turn cannot reach a connector added after the claim through the broker', async () => {
    const { machineId, deps, s } = coordinatorWorld(true);
    await claimStep(deps, machineId, s.team.id, 10, 'http://localhost');
    connector(s, 'notion', { headers: { Authorization: 'Bearer notion-token' } });
    await expect(
      executeRelayToolCall(deps, machineId, 's1', 'connector_notion__PING', {}),
    ).rejects.toThrow(/grant/);
  });
});
