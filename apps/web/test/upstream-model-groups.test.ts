import { describe, expect, it } from 'vitest';
import { groupDevinUpstream } from '../src/resources/upstream-model-groups.js';
import type { UpstreamOption } from '../src/resources/upstream-model-picker.js';

const option = (id: string, family?: string): UpstreamOption => ({ id, name: id, family });

describe('groupDevinUpstream', () => {
  it('orders native first, vendors alphabetically, fusion last', () => {
    const groups = groupDevinUpstream([
      option('fusion-a-b', 'Fusion'),
      option('gpt-6-1-sol', 'GPT-6.1'),
      option('swe-2-high', 'SWE-2'),
      option('claude-opus-5-5-medium', 'Claude Opus 5.5'),
      option('adaptive', 'Adaptive'),
    ]);
    expect(groups.map(([label]) => label)).toEqual([
      'Devin 原生',
      'Claude',
      'GPT',
      'Fusion 组合',
    ]);
    expect(groups[0]?.[1].map((model) => model.id)).toEqual(['swe-2-high', 'adaptive']);
  });

  it('derives the vendor label from the family when the id is unknown', () => {
    const groups = groupDevinUpstream([option('acme-turbo', 'Acme Ultra')]);
    expect(groups.map(([label]) => label)).toEqual(['Acme']);
  });

  it('falls back to 其他 for empty ids', () => {
    const groups = groupDevinUpstream([option('')]);
    expect(groups.map(([label]) => label)).toEqual(['其他']);
  });
});
