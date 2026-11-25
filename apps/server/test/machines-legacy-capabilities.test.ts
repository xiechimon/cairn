import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  machine as machineTable,
  routingRule as routingRuleTable,
  team as teamTable,
} from '../src/db/schema.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { executeMcpTool } from '../src/services/mcp-face.js';
import {
  listAntigravitySources,
  listClaudeCodeSources,
  listDevinSources,
  listGeminiSources,
} from '../src/services/providers.js';
import { bootServer, issueApiKey, req, seedSessionRoute, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

function boot(opts: { authToken?: string } = {}): TestServer {
  const s = bootServer({ claimHoldMs: 100, ...opts });
  servers.push(s);
  return s;
}

function toolDepsOf(s: TestServer) {
  return {
    db: s.db,
    hub: s.hub,
    machineHub: s.machineHub,
    box: s.secretBox,
    user: s.user,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
}

describe('machines list tolerates legacy or unknown stored capabilities.computerKind', () => {
  test('a stored machine row with computerKind "vm" does not break GET /api/teams/:id/machines and drops computerKind', async () => {
    const s = boot();
    const now = Date.now();
    s.db
      .insert(machineTable)
      .values([
        {
          id: 'vm-offline',
          teamId: s.team.id,
          name: 'old-vm-runner',
          online: false,
          lastSeenAt: now - 60_000,
          kind: 'remote',
          capabilities: {
            mcpServers: ['figma'],
            skills: ['verify-cairn'],
            computer: true,
            computerKind: 'vm',
          } as never,
        },
        {
          id: 'host-online',
          teamId: s.team.id,
          name: 'healthy-host',
          online: true,
          lastSeenAt: now,
          kind: 'remote',
          capabilities: {
            mcpServers: [],
            skills: [],
            computer: true,
            computerKind: 'host',
          },
        },
      ])
      .run();

    const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as {
      id: string;
      capabilities?: Record<string, unknown> | null;
    }[];
    const vmRow = list.find((m) => m.id === 'vm-offline');
    const hostRow = list.find((m) => m.id === 'host-online');
    expect(vmRow).toBeDefined();
    expect(vmRow?.capabilities).toEqual({
      mcpServers: ['figma'],
      skills: ['verify-cairn'],
      computer: true,
    });
    expect(hostRow?.capabilities).toEqual({
      mcpServers: [],
      skills: [],
      computer: true,
      computerKind: 'host',
    });
  });

  test('a stored machine row with an unknown computerKind string does not break GET /api/teams/:id/machines and drops computerKind', async () => {
    const s = boot();
    const now = Date.now();
    s.db
      .insert(machineTable)
      .values([
        {
          id: 'unknown-kind',
          teamId: s.team.id,
          name: 'future-runner',
          online: false,
          lastSeenAt: now - 60_000,
          kind: 'remote',
          capabilities: {
            mcpServers: ['docs'],
            skills: [],
            computer: true,
            computerKind: 'future-sandbox',
          } as never,
        },
        {
          id: 'other-runner',
          teamId: s.team.id,
          name: 'other-runner',
          online: true,
          lastSeenAt: now,
          kind: 'remote',
          capabilities: {
            mcpServers: [],
            skills: [],
          },
        },
      ])
      .run();

    const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as {
      id: string;
      capabilities?: Record<string, unknown> | null;
    }[];
    expect(list.find((m) => m.id === 'other-runner')).toBeDefined();
    const unknownRow = list.find((m) => m.id === 'unknown-kind');
    expect(unknownRow?.capabilities).toEqual({
      mcpServers: ['docs'],
      skills: [],
      computer: true,
    });
  });

  test('PATCH /api/machines/:id and GET /api/machine/me tolerate stale computerKind "vm" in stored capabilities', async () => {
    const s = boot();
    const apiKey = await issueApiKey(s);
    const enrollRes = await s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        teamId: s.team.id,
        name: 'enrolled-runner',
        cliVersion: '0.1.0',
      }),
    });
    expect(enrollRes.status).toBe(200);
    const { machineId, token } = (await enrollRes.json()) as { machineId: string; token: string };
    s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          computerKind: 'vm',
        } as never,
      })
      .where(eq(machineTable.id, machineId))
      .run();

    const meRes = await s.app.request('/api/machine/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meRes.status).toBe(200);
    expect(
      ((await meRes.json()) as { capabilities?: Record<string, unknown> }).capabilities,
    ).toEqual({
      mcpServers: [],
      skills: [],
    });

    const patchRes = await req(s.app, 'PATCH', `/api/machines/${machineId}`, {
      name: 'renamed-runner',
    });
    expect(patchRes.status).toBe(200);
    expect(
      ((await patchRes.json()) as { capabilities?: Record<string, unknown> }).capabilities,
    ).toEqual({
      mcpServers: [],
      skills: [],
    });
  });
});

describe('retired machines are excluded from user-facing lists and re-enroll deduplicates by normalized hostname', () => {
  test('a retired machine row is not returned by GET /api/teams/:id/machines, chief tools, MCP face, or model sources', async () => {
    const s = boot();
    const now = Date.now();
    s.db
      .insert(machineTable)
      .values([
        {
          id: 'retired-row',
          teamId: s.team.id,
          name: 'stale-retired-mac',
          online: false,
          lastSeenAt: now - 60_000,
          retiredAt: now - 10_000,
          kind: 'remote',
          claudeCodeReport: { installed: true, hostname: 'stale-retired-mac', models: [] },
          capabilities: {
            mcpServers: [],
            skills: [],
            devin: { installed: true },
            gemini: { installed: true },
            antigravity: { installed: true },
          },
        },
        {
          id: 'active-row',
          teamId: s.team.id,
          name: 'active-mac',
          online: true,
          lastSeenAt: now,
          kind: 'remote',
          claudeCodeReport: { installed: true, hostname: 'active-mac', models: [] },
          capabilities: {
            mcpServers: [],
            skills: [],
            devin: { installed: true },
            gemini: { installed: true },
            antigravity: { installed: true },
          },
        },
      ])
      .run();

    const listRes = await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { id: string }[];
    expect(list.map((m) => m.id)).toEqual(['active-row']);

    const deps = toolDepsOf(s);
    const chiefOut = JSON.parse(
      await executeChiefTool(
        deps,
        {
          teamId: s.team.id,
          userId: s.user.id,
          chiefId: 'chief-1',
          threadId: 'chief-thread-1',
          chiefAgentId: 'agent-1',
          conversationId: 'chief-thread-1',
        },
        'machines',
        {},
      ),
    ) as { id: string }[];
    expect(chiefOut.map((m) => m.id)).toEqual(['active-row']);

    const mcpOut = JSON.parse(
      await executeMcpTool(
        deps,
        { teamId: s.team.id, user: s.user, grants: new Set(['machines']) },
        'machines',
        {},
      ),
    ) as { id: string }[];
    expect(mcpOut.map((m) => m.id)).toEqual(['active-row']);

    expect(listClaudeCodeSources(s.db, s.team.id).map((m) => m.machineId)).toEqual(['active-row']);
    expect(listDevinSources(s.db, s.team.id).map((m) => m.machineId)).toEqual(['active-row']);
    expect(listGeminiSources(s.db, s.team.id).map((m) => m.machineId)).toEqual(['active-row']);
    expect(listAntigravitySources(s.db, s.team.id).map((m) => m.machineId)).toEqual(['active-row']);
  });

  test('re-enrolling the same computer without hostKey (X then X.local) retires the old row, migrates default and routing rules, and leaves one visible row', async () => {
    const s = boot();
    const key1 = await issueApiKey(s);
    const first = await s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${key1}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        teamId: s.team.id,
        name: 'studio-mac',
        cliVersion: '0.1.0',
      }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { machineId: string };
    s.db
      .update(teamTable)
      .set({ defaultMachineId: firstBody.machineId })
      .where(eq(teamTable.id, s.team.id))
      .run();
    const ruleId = seedSessionRoute(s, {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: firstBody.machineId,
    });

    const key2 = await issueApiKey(s);
    const second = await s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${key2}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        teamId: s.team.id,
        name: 'studio-mac.local',
        cliVersion: '0.2.0',
      }),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { machineId: string };
    expect(secondBody.machineId).not.toBe(firstBody.machineId);

    const listRes = await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { id: string; name: string }[];
    expect(list.map((m) => m.id)).toEqual([secondBody.machineId]);

    const oldRow = s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.id, firstBody.machineId))
      .get();
    expect(oldRow?.retiredAt).not.toBeNull();
    expect(
      s.db.select().from(teamTable).where(eq(teamTable.id, s.team.id)).get()?.defaultMachineId,
    ).toBe(secondBody.machineId);
    expect(
      s.db.select().from(routingRuleTable).where(eq(routingRuleTable.id, ruleId)).get()?.machineId,
    ).toBe(secondBody.machineId);

    const start = await s.app.request('/api/machine/enroll/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'studio-mac' }),
    });
    expect(start.status).toBe(200);
    const { enrollId } = (await start.json()) as { enrollId: string };
    const confirm = await s.app.request('/api/machine/enroll/confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enrollId }),
    });
    expect(confirm.status).toBe(200);
    const thirdBody = ((await confirm.json()) as { machine: { machineId: string } }).machine;

    const listAfterBrowser = (await (
      await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`)
    ).json()) as { id: string }[];
    expect(listAfterBrowser.map((m) => m.id)).toEqual([thirdBody.machineId]);
    expect(
      s.db.select().from(teamTable).where(eq(teamTable.id, s.team.id)).get()?.defaultMachineId,
    ).toBe(thirdBody.machineId);
    expect(
      s.db.select().from(routingRuleTable).where(eq(routingRuleTable.id, ruleId)).get()?.machineId,
    ).toBe(thirdBody.machineId);
  });
});
