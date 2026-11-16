import { describe, expect, test } from 'vitest';
import { hasUsableClaudeSubscription } from '../src/api/claude-subscriptions.js';
import type { ModelOption } from '../src/fixtures/records.js';
import { suggestedTopModels } from '../src/resources/top-models-card.js';

const NOW = 1_700_000_000_000;

const OPTIONS: ModelOption[] = [
  {
    runtime: 'claude-code',
    provider: 'claude-code',
    machineId: 'm1',
    providerLabel: 'Claude Code',
    modelId: 'claude-opus-5-5',
    modelName: 'Claude Opus 5.5',
  },
  {
    runtime: 'pi',
    provider: 'anthropic',
    providerLabel: 'Anthropic',
    modelId: 'claude-sonnet-5-5',
    modelName: 'Claude Sonnet 5.5',
  },
];

describe('suggestedTopModels', () => {
  test('suggests Claude Code models only when the team has a usable Claude subscription', () => {
    expect(suggestedTopModels(OPTIONS, true).map((m) => [m.provider, m.modelId])).toEqual([
      ['claude-code', 'claude-opus-5-5'],
      ['anthropic', 'claude-sonnet-5-5'],
    ]);
    expect(suggestedTopModels(OPTIONS, false).map((m) => [m.provider, m.modelId])).toEqual([
      ['anthropic', 'claude-sonnet-5-5'],
    ]);
  });
});

describe('hasUsableClaudeSubscription', () => {
  const base = { enabled: true, expiresAt: null };
  test('an enabled subscription that has not expired is usable', () => {
    expect(hasUsableClaudeSubscription([base], NOW)).toBe(true);
    expect(hasUsableClaudeSubscription([{ ...base, expiresAt: NOW + 1 }], NOW)).toBe(true);
  });

  test('none, expired or disabled subscriptions are not usable', () => {
    expect(hasUsableClaudeSubscription(undefined, NOW)).toBe(false);
    expect(hasUsableClaudeSubscription([], NOW)).toBe(false);
    expect(hasUsableClaudeSubscription([{ ...base, expiresAt: NOW }], NOW)).toBe(false);
    expect(hasUsableClaudeSubscription([{ ...base, enabled: false }], NOW)).toBe(false);
  });
});
