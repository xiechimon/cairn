import { describe, expect, it } from 'vitest';
import {
  groupAntigravityUpstream,
  groupDevinUpstream,
} from '../src/resources/upstream-model-groups.js';
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

describe('groupAntigravityUpstream', () => {
  it('groups Antigravity models into Gemini, Claude, and GPT-OSS in family order', () => {
    const groups = groupAntigravityUpstream([
      { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
      { id: 'gemini-pro-orchestrator', name: 'Orchestrator (Carbon)' },
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
    ]);
    expect(groups.map(([label]) => label)).toEqual(['Claude', 'Gemini', 'GPT-OSS']);
    expect(groups[0]?.[1].map((model) => model.id)).toEqual([
      'claude-sonnet-4-6',
      'claude-opus-5-5',
    ]);
    expect(groups[1]?.[1].map((model) => model.id)).toEqual([
      'gemini-3.8-flash',
      'gemini-pro-orchestrator',
    ]);
    expect(groups[2]?.[1].map((model) => model.id)).toEqual(['gpt-oss-120b-medium']);
  });
});
