import { CHIEF_REMOTE_TOOLS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { AGENT_ID, H, registerChiefHarness, relay, seedMachineReport } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

describe('51-vocabulary relay execution surface (02 section 4.3)', () => {
  test('out-of-vocabulary tool name -> 400 (whitelist discipline, not executed)', async () => {
    let status = 0;
    try {
      await relay('not_a_tool', {});
    } catch (err) {
      status = err instanceof HttpError ? err.status : 0;
    }
    expect(status).toBe(400);
  });

  test('set_remote_shell grant: REST writes a neighbor entry first -> chief adds the remote-shell switch word -> REST GET readback matches (acceptance #2)', async () => {
    const patch = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/agents/${AGENT_ID}`, {
      tools: ['推送分支'],
    });
    expect(patch.status).toBe(200);
    const granted = (await relay('set_remote_shell', { agentId: AGENT_ID, enabled: true })) as {
      agentId: string;
      remoteShell: boolean;
      tools: string[];
    };
    expect(granted).toEqual({
      agentId: AGENT_ID,
      remoteShell: true,
      tools: ['推送分支', '远程 shell'],
    });
    const readback = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/agents/${AGENT_ID}`);
    const record = (await readback.json()) as { tools: string[] };
    expect(record.tools).toEqual(['推送分支', '远程 shell']);
  });

  test('revoke removes only the remote-shell switch word: neighbors and order untouched; repeat grant is idempotent', async () => {
    H.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell', '推送分支'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const revoked = (await relay('set_remote_shell', { agentId: AGENT_ID, enabled: false })) as {
      remoteShell: boolean;
      tools: string[];
    };
    expect(revoked.remoteShell).toBe(false);
    expect(revoked.tools).toEqual(['推送分支']);
    expect(
      H.s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get()!.tools,
    ).toEqual(['推送分支']);
    await relay('set_remote_shell', { agentId: AGENT_ID, enabled: true });
    await relay('set_remote_shell', { agentId: AGENT_ID, enabled: true });
    expect(
      H.s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get()!.tools,
    ).toEqual(['推送分支', '远程 shell']);
  });

  test('the write path goes through filterAgentTools: stale entries are swept on write (same rule as REST PATCH)', async () => {
    H.s.db
      .update(agentTable)
      .set({ tools: ['自造档', '推送分支'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    await relay('set_remote_shell', { agentId: AGENT_ID, enabled: true });
    expect(
      H.s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get()!.tools,
    ).toEqual(['推送分支', '远程 shell']);
  });

  test('missing or non-boolean enabled -> 400 and the row is not written (fail-closed; no pre-#573 default-true)', async () => {
    for (const bad of [{ agentId: AGENT_ID }, { agentId: AGENT_ID, enabled: 'yes' }]) {
      let status = 0;
      try {
        await relay('set_remote_shell', bad);
      } catch (err) {
        status = err instanceof HttpError ? err.status : 0;
      }
      expect(status).toBe(400);
    }
    expect(
      H.s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get()!.tools,
    ).toEqual([]);
  });

  test('unknown agentId -> 404 (same requireTeamAgent rule, no stray write)', async () => {
    let status = 0;
    let message = '';
    try {
      await relay('set_remote_shell', { agentId: 'agent-nope', enabled: true });
    } catch (err) {
      status = err instanceof HttpError ? err.status : 0;
      message = err instanceof HttpError ? err.message : '';
    }
    expect(status).toBe(404);
    expect(message).toContain('agent-nope');
  });

  test('models: no custom provider and claude-code not installed -> empty list without error', async () => {
    expect(await relay('models', {})).toEqual([]);
  });

  test('models: providers write surface works as usual; candidates come from report rows (dedupe + row hygiene)', async () => {
    const provRes = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/providers`, {
      providerId: 'gw-a',
      label: '网关甲',
      baseUrl: 'https://a.example.com/v1',
      api: 'openai-completions',
      models: [
        { id: 'model-a', name: '模型甲' },
        { id: 'model-b', name: '' },
        { id: '', name: '空 id 行' },
      ],
    });
    expect(provRes.status).toBe(201);
    seedMachineReport('exec-1', {
      installed: true,
      hostname: 'exec-host-1',
      models: [
        { id: 'claude-opus-4-5', name: 'claude-opus-4-5' },
        { id: 'claude-opus-4-5', name: 'claude-opus-4-5' },
      ],
    });
    const rows = (await relay('models', {})) as {
      provider: string;
      providerLabel: string;
      modelId: string;
      modelName: string;
    }[];
    expect(rows).toEqual([
      { provider: 'pi', providerLabel: 'pi', modelId: 'model-a', modelName: '模型甲' },
      { provider: 'pi', providerLabel: 'pi', modelId: 'model-b', modelName: 'model-b' },
      {
        provider: 'claude-code',
        providerLabel: 'Claude Code',
        modelId: 'claude-opus-4-5',
        modelName: 'claude-opus-4-5',
      },
    ]);
  });

  test('models: a custom provider named claude-code no longer shadows report rows (#770/#707)', async () => {
    const provRes = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/providers`, {
      providerId: 'claude-code',
      label: '同名网关',
      baseUrl: 'https://cc.example.com/v1',
      api: 'openai-completions',
      models: [{ id: 'm-cc', name: '同名行' }],
    });
    expect(provRes.status).toBe(201);
    seedMachineReport('exec-1', {
      installed: true,
      hostname: 'exec-host-1',
      models: [{ id: 'm-cc', name: 'm-cc' }],
    });
    const rows = (await relay('models', {})) as {
      provider: string;
      providerLabel: string;
      modelId: string;
      modelName: string;
    }[];
    expect(rows).toEqual([
      { provider: 'pi', providerLabel: 'pi', modelId: 'm-cc', modelName: '同名行' },
      { provider: 'claude-code', providerLabel: 'Claude Code', modelId: 'm-cc', modelName: 'm-cc' },
    ]);
  });

  test('read-tool replaySafe flags match execution (sampled projects/todos/machines/models)', async () => {
    for (const name of ['projects', 'todos', 'machines', 'models']) {
      const def = CHIEF_REMOTE_TOOLS.find((t) => t.name === name)!;
      expect(def.replaySafe).toBe(true);
      expect(await relay(name, {})).toBeDefined();
    }
  });
});
