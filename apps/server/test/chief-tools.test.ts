import { CHIEF_REMOTE_TOOLS } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { HttpError } from '../src/lib/errors.js';
import { H, registerChiefHarness, relay, seedMachineReport } from './chief-harness.js';
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
