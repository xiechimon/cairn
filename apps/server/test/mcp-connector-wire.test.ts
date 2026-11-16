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
import { claimStep, stepToken } from '../src/services/machines.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import {
  bootServer,
  enrollConnectorRunner,
  insertMachine,
  postProject,
  queueConnectorStep,
  seedRoute,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

async function world(mcpServers: string[]) {
  const s = bootServer({ claimHoldMs: 100 });
  onTestFinished(() => s.dispose());
  const projectId = await postProject(s.app, 'mcp-wire-proj');
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model', mcpServers });
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
  test('a step granted a connector is not claimed by a Runner without connector support and says why', async () => {
    const { s, projectId } = await world(['linear']);
    connector(s, 'linear');
    const old = await enrollConnectorRunner(s, 'old-runner', false);
    const stepId = queueConnectorStep(s, projectId, old.machineId);
    expect(await claim(s, old.machineId)).toBeNull();
    const pending = s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
    const target = { id: stepId, createdAt: pending?.createdAt ?? 0, homeMachineId: old.machineId };
    expect(stepQueueProjector(s.db, s.team.id).project(target)?.blocked).toEqual({
      kind: 'capability-missing',
      missing: ['MCP connector support (update cairn on the Runner)'],
    });
  });

  test('a Runner with connector support claims the step and gets only granted, deliverable connectors', async () => {
    const { s, projectId } = await world(['linear', 'files', 'notion']);
    connector(s, 'linear', { headers: { Authorization: 'Bearer lin-static-token' } });
    connector(s, 'notion', { status: 'needs_auth' });
    connector(s, 'github', { headers: { Authorization: 'Bearer not-granted' } });
    const current = await enrollConnectorRunner(s, 'new-runner', true);
    const stepId = queueConnectorStep(s, projectId, current.machineId);
    const claimed = await claim(s, current.machineId);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.mcpServers).toEqual(['linear', 'files', 'notion']);
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
    expect(JSON.stringify(token)).not.toContain('not-granted');
  });

  test('a step whose grant names only local servers still runs on an older Runner', async () => {
    const { s, projectId } = await world(['files']);
    connector(s, 'linear', { headers: { Authorization: 'Bearer lin-static-token' } });
    const old = await enrollConnectorRunner(s, 'old-runner', false);
    const stepId = queueConnectorStep(s, projectId, old.machineId);
    const claimed = await claim(s, old.machineId);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.mcpServers).toEqual(['files']);
    const token = await tokenOf(s, old.token, stepId);
    expect(token.mcpConnectors).toBeUndefined();
    expect(token.withheldMcp).toBeUndefined();
  });
});

const THREAD = 'chief-mcp-thread';

function coordinatorWorld(connectors: boolean) {
  setCoordinatorInServer(true);
  onTestFinished(() => setCoordinatorInServer(false));
  const s = bootServer({ githubFetch: async () => new Response('[]') });
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
    mcpServers: ['linear', 'files'],
  });
  connector(s, 'linear', { headers: { Authorization: 'Bearer lin-static-token' } });
  s.db
    .insert(chiefTable)
    .values({ id: 'c1', userId: s.svc.user.id, teamId: s.team.id, charter: '', createdAt: 1 })
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
    expect(claimed?.mcpServers).toEqual(['linear', 'files']);
    const token = await stepToken(deps, machineId, 's1');
    expect(token.mcpConnectors?.map((c) => c.slug)).toEqual(['linear']);
  });

  test('an older Runner still runs the turn without the connector and the thread says so', async () => {
    const { machineId, deps, s } = coordinatorWorld(false);
    const claimed = await claimStep(deps, machineId, s.team.id, 10, 'http://localhost');
    expect(claimed?.step.id).toBe('s1');
    expect(claimed?.mcpServers).toEqual(['files']);
    expect((await stepToken(deps, machineId, 's1')).mcpConnectors).toBeUndefined();
    const notes = s.db
      .select()
      .from(chiefMessageTable)
      .where(eq(chiefMessageTable.threadId, THREAD))
      .all()
      .map((row) => JSON.parse(String(row.content)) as { kind: string; message: string });
    expect(notes).toEqual([
      expect.objectContaining({
        kind: 'chief_notice',
        message: 'MCP connectors linear are unavailable this turn: the Runner needs a newer cairn.',
      }),
    ]);
  });
});
