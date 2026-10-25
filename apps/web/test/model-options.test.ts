import type { ModelSource } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { toModelOptions } from '../src/api/mappers.js';

function ccSource(models: ModelSource['models'], installed = true): ModelSource {
  return { runtime: 'claude-code', installed, hostname: 'test-host', models };
}

function piSource(models: ModelSource['models']): ModelSource {
  return { runtime: 'pi', installed: true, hostname: 'test-host', models };
}

describe('toModelOptions (#358 data-source projection, #770 providers section removed, #1288 pi section regression)', () => {
  it('F1: empty sources → empty list', () => {
    expect(toModelOptions([])).toEqual([]);
  });

  it('F3: claude-code section → runtime vocab value as provider, brand name as label', () => {
    const rows = toModelOptions([
      ccSource([{ id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' }]),
    ]);
    expect(rows).toEqual([
      {
        provider: 'claude-code',
        providerLabel: 'Claude Code',
        modelId: 'claude-opus-4-5',
        modelName: 'claude-opus-4-5',
      },
    ]);
  });

  it('F4: pi section of sources yields rows (#1288 relay catalog enters candidates)', () => {
    const rows = toModelOptions([piSource([{ id: 'm-a', name: 'M A' }])]);
    expect(rows).toEqual([
      {
        provider: 'pi',
        providerLabel: 'pi',
        modelId: 'm-a',
        modelName: 'M A',
      },
    ]);
  });

  it('F5: claude-code multi-slot same id → first-wins dedup', () => {
    const rows = toModelOptions([
      ccSource([
        { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' },
        { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'opus' },
      ]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.modelId).toBe('claude-opus-4-5');
  });

  it('F5a: same key across envelope entries → first-wins dedup (first name kept)', () => {
    const rows = toModelOptions([
      ccSource([{ id: 'm-x', name: '首名' }]),
      ccSource([{ id: 'm-x', name: '次名' }]),
    ]);
    expect(rows).toEqual([
      {
        provider: 'claude-code',
        providerLabel: 'Claude Code',
        modelId: 'm-x',
        modelName: '首名',
      },
    ]);
  });

  it('F5b: same model id across families (pi section + claude-code section) → dedup by model id', () => {
    const rows = toModelOptions([
      piSource([{ id: 'm-relay', name: 'relay 名' }]),
      ccSource([{ id: 'm-relay', name: '槽位名' }]),
    ]);

    expect(rows.map((r) => r.modelId)).toEqual(['m-relay']);
  });

  it('F6: uninstalled section (models=[]) → no row contribution, no crash', () => {
    expect(toModelOptions([ccSource([], false)])).toEqual([]);
  });

  it('F7: order = runtime sections in envelope order', () => {
    const rows = toModelOptions([
      piSource([{ id: 'm-a', name: 'M A' }]),
      ccSource([{ id: 'm-cc', name: 'm-cc' }]),
    ]);
    expect(rows.map((r) => `${r.provider}/${r.modelId}`)).toEqual(['pi/m-a', 'claude-code/m-cc']);
  });

  it('F8: empty-id rows skipped', () => {
    const rows = toModelOptions([
      ccSource([
        { id: '', name: '幽灵行' },
        { id: 'm1', name: 'm1' },
      ]),
    ]);
    expect(rows.map((r) => r.modelId)).toEqual(['m1']);
  });

  it('F9: strict liveness — same model id marked dead by any source marks the row dead', () => {
    const rows = toModelOptions([
      piSource([{ id: 'm-dead', name: 'm-dead', liveness: 'alive' }]),
      ccSource([{ id: 'm-dead', name: 'm-dead', liveness: 'dead' }]),
      ccSource([{ id: 'm-alive', name: 'm-alive', liveness: 'alive' }]),
      piSource([{ id: 'm-unknown', name: 'm-unknown' }]),
    ]);
    const byId = new Map(rows.map((r) => [r.modelId, r]));
    expect(byId.get('m-dead')?.liveness).toBe('dead');
    expect(byId.get('m-alive')?.liveness).toBe('alive');
    expect(byId.get('m-unknown')?.liveness).toBeUndefined();
  });
});
