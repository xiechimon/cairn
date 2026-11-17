import { describe, expect, test } from 'vitest';
import { hasUsableClaudeSubscription } from '../src/api/claude-subscriptions.js';
import { hasUsableDevinSubscription } from '../src/api/devin-subscriptions.js';
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
    runtime: 'devin',
    provider: 'devin',
    machineId: 'm1',
    providerLabel: 'Devin',
    modelId: 'devin-swe-2',
    modelName: 'Devin SWE 2',
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
    expect(
      suggestedTopModels(OPTIONS, { claude: true, devin: true }).map((m) => [
        m.provider,
        m.modelId,
      ]),
    ).toEqual([
      ['claude-code', 'claude-opus-5-5'],
      ['anthropic', 'claude-sonnet-5-5'],
    ]);
    expect(
      suggestedTopModels(OPTIONS, { claude: false, devin: true }).map((m) => [
        m.provider,
        m.modelId,
      ]),
    ).toEqual([['anthropic', 'claude-sonnet-5-5']]);
  });

  test('a devin model only appears in the options when the team has a usable Devin subscription', () => {
    const devinOnly: ModelOption[] = [
      {
        runtime: 'devin',
        provider: 'devin',
        providerLabel: 'Devin',
        modelId: 'claude-opus-5-5',
        modelName: 'Claude Opus 5.5',
      },
    ];
    expect(
      suggestedTopModels(devinOnly, { claude: false, devin: true }).map((m) => m.provider),
    ).toEqual(['devin']);
    expect(suggestedTopModels(devinOnly, { claude: true, devin: false })).toEqual([]);
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

describe('hasUsableDevinSubscription', () => {
  const base = { enabled: true, expiresAt: null };
  test('an enabled subscription that has not expired is usable', () => {
    expect(hasUsableDevinSubscription([base], NOW)).toBe(true);
    expect(hasUsableDevinSubscription([{ ...base, expiresAt: NOW + 1 }], NOW)).toBe(true);
  });

  test('none, expired or disabled subscriptions are not usable', () => {
    expect(hasUsableDevinSubscription(undefined, NOW)).toBe(false);
    expect(hasUsableDevinSubscription([], NOW)).toBe(false);
    expect(hasUsableDevinSubscription([{ ...base, expiresAt: NOW }], NOW)).toBe(false);
    expect(hasUsableDevinSubscription([{ ...base, enabled: false }], NOW)).toBe(false);
  });
});
