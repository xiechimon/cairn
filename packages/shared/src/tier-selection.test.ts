import { describe, expect, test } from 'vitest';
import {
  DEFAULT_ANTIGRAVITY_MODELS,
  DEFAULT_CLAUDE_CODE_MODELS,
  DEFAULT_DEVIN_MODELS,
} from './records/model-source.js';
import { PROVIDER_PRESET_DEFAULTS } from './records/provider-preset-data.js';
import {
  type CatalogTierModel,
  selectSourceTiers,
  tierFallbackOrder,
  tierFamilyKey,
} from './tier-selection.js';

describe('tierFamilyKey', () => {
  test('preserves parameter size tokens across version dedup', () => {
    expect(tierFamilyKey('acme-7b')).not.toBe(tierFamilyKey('acme-70b'));
    expect(tierFamilyKey('qwen3-8b')).not.toBe(tierFamilyKey('qwen3-72b'));
    expect(tierFamilyKey('claude-sonnet-4-5')).toBe(tierFamilyKey('claude-sonnet-5-5'));
    expect(tierFamilyKey('claude-sonnet-5-5-20260929')).toBe(tierFamilyKey('claude-sonnet-5-5'));
  });
});

describe('selectSourceTiers', () => {
  test('empty, non-chat, and all-banned catalogs return null', () => {
    expect(selectSourceTiers([])).toBeNull();
    expect(
      selectSourceTiers([
        { id: 'text-embedding-3-large', name: 'Embedding' },
        { id: 'tts-1', name: 'TTS' },
        { id: 'gemini-pro-orchestrator', name: 'Orchestrator' },
        { id: 'chat_1234', name: 'Internal' },
      ]),
    ).toBeNull();
    expect(
      selectSourceTiers([
        {
          id: 'gpt-6-astra',
          name: 'Astra',
          cost: { input: 5, output: 15, cacheRead: 0, cacheWrite: 0 },
        },
        {
          id: 'minimax-m3',
          name: 'MiniMax M3',
          cost: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
        },
      ]),
    ).toBeNull();
  });

  test('1 model assigns all three tiers to that sole model', () => {
    const tiers = selectSourceTiers([{ id: 'only-model', name: 'Only Model' }]);
    expect(tiers).toEqual({
      easy: 'only-model',
      standard: 'only-model',
      hard: 'only-model',
      ordered: ['only-model'],
    });
  });

  test('2 models place lightweight first and avoid underpowering medium on flash/mini', () => {
    const fastAndFlagship = selectSourceTiers([
      {
        id: 'acme-mini',
        name: 'Acme Mini',
        cost: { input: 0.2, output: 0.8, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'acme-core',
        name: 'Acme Core',
        cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
      },
    ]);
    expect(fastAndFlagship).toEqual({
      easy: 'acme-mini',
      standard: 'acme-core',
      hard: 'acme-core',
      ordered: ['acme-mini', 'acme-core'],
    });

    const balancedAndReasoner = selectSourceTiers([
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        cost: { input: 0.27, output: 1.1, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        reasoning: true,
        cost: { input: 0.55, output: 2.19, cacheRead: 0, cacheWrite: 0 },
      },
    ]);
    expect(balancedAndReasoner).toEqual({
      easy: 'deepseek-chat',
      standard: 'deepseek-chat',
      hard: 'deepseek-reasoner',
      ordered: ['deepseek-chat', 'deepseek-reasoner'],
    });
  });

  test('3+ priced and subscription catalogs pick distinct tiers without hardcoded lists', () => {
    const antigravity = selectSourceTiers(DEFAULT_ANTIGRAVITY_MODELS);
    expect(antigravity).not.toBeNull();
    expect(antigravity!.easy).toBe('gemini-3.8-flash');
    expect(antigravity!.hard).not.toBe(antigravity!.easy);
    expect(new Set([antigravity!.easy, antigravity!.standard, antigravity!.hard]).size).toBe(3);

    const claude = selectSourceTiers(DEFAULT_CLAUDE_CODE_MODELS);
    expect(claude).toMatchObject({
      easy: 'claude-haiku-5-5',
      standard: 'claude-sonnet-5-5',
      hard: 'claude-opus-5-5',
    });

    const devin = selectSourceTiers(DEFAULT_DEVIN_MODELS);
    expect(devin).not.toBeNull();
    expect(devin!.easy).toBe('swe-2-flash-medium');
    expect(devin!.hard).toBe('swe-2-1-medium');
    expect(devin!.ordered).not.toContain('adaptive');

    const anthropicPreset = selectSourceTiers(PROVIDER_PRESET_DEFAULTS.anthropic?.models ?? []);
    expect(anthropicPreset).not.toBeNull();
    expect(
      new Set([anthropicPreset!.easy, anthropicPreset!.standard, anthropicPreset!.hard]).size,
    ).toBe(3);

    const antLing = selectSourceTiers(PROVIDER_PRESET_DEFAULTS['ant-ling']?.models ?? []);
    expect(antLing).not.toBeNull();
    expect(antLing!.easy).toBe('Ling-2.6-flash');
  });

  test('3+ models collapsing to 1 or 2 after version dedup behave consistently', () => {
    const collapsedToOne = selectSourceTiers([
      {
        id: 'grok-4.5',
        name: 'Grok 4.5',
        cost: { input: 2, output: 6, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'grok-4.6',
        name: 'Grok 4.6',
        cost: { input: 2, output: 6, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'grok-4.7',
        name: 'Grok 4.7',
        cost: { input: 2, output: 6, cacheRead: 0, cacheWrite: 0 },
      },
    ]);
    expect(collapsedToOne).toEqual({
      easy: 'grok-4.7',
      standard: 'grok-4.7',
      hard: 'grok-4.7',
      ordered: ['grok-4.7'],
    });
  });

  test('short-context models (<32k) are filtered even on 3-model catalogs when >=32k exists', () => {
    const tiers = selectSourceTiers([
      {
        id: 'tiny-ctx-reasoner',
        name: 'Tiny Context',
        contextWindow: 8_192,
        cost: { input: 20, output: 60, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'fast-long',
        name: 'Fast Long',
        contextWindow: 128_000,
        cost: { input: 0.2, output: 0.8, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'pro-long',
        name: 'Pro Long',
        contextWindow: 200_000,
        cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
      },
    ]);
    expect(tiers?.ordered).toEqual(['fast-long', 'pro-long']);
    expect(tiers?.hard).toBe('pro-long');
  });

  test('large catalog clamps $0 free outliers and keeps midpoint distinct from endpoints', () => {
    const largeCatalog: CatalogTierModel[] = [
      {
        id: 'promo-free',
        contextWindow: 128_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'tier-a',
        contextWindow: 128_000,
        cost: { input: 0.1, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'tier-b',
        contextWindow: 128_000,
        cost: { input: 0.3, output: 1.0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'tier-c',
        contextWindow: 128_000,
        cost: { input: 1.0, output: 4.0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'tier-d',
        contextWindow: 128_000,
        cost: { input: 2.0, output: 8.0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'tier-e',
        contextWindow: 128_000,
        cost: { input: 4.0, output: 16.0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'tier-f',
        contextWindow: 128_000,
        cost: { input: 10.0, output: 30.0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'tier-g',
        contextWindow: 128_000,
        cost: { input: 25.0, output: 75.0, cacheRead: 0, cacheWrite: 0 },
      },
    ];
    const tiers = selectSourceTiers(largeCatalog)!;
    expect(tiers.ordered).not.toContain('promo-free');
    expect(tiers.easy).toBe('tier-a');
    expect(tiers.standard).not.toBe(tiers.easy);
    expect(tiers.standard).not.toBe(tiers.hard);
    expect(tiers.hard).toBe('tier-g');
  });

  test('unpriced vs zero-cost free models and unpriced middle between priced endpoints', () => {
    const mixed = selectSourceTiers([
      { id: 'free-model', cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { id: 'opaque-middle' },
      { id: 'paid-pro', cost: { input: 5, output: 15, cacheRead: 0, cacheWrite: 0 } },
    ]);
    expect(mixed).toEqual({
      easy: 'free-model',
      standard: 'opaque-middle',
      hard: 'paid-pro',
      ordered: ['free-model', 'opaque-middle', 'paid-pro'],
    });
  });

  test('zero-signal opaque relay preserves configured default instead of guessing', () => {
    const opaque = selectSourceTiers(
      [
        { id: 'alias-alpha', name: 'Alias Alpha' },
        { id: 'alias-beta', name: 'Alias Beta' },
        { id: 'alias-gamma', name: 'Alias Gamma' },
      ],
      'alias-beta',
    );
    expect(opaque).toEqual({
      easy: 'alias-beta',
      standard: 'alias-beta',
      hard: 'alias-beta',
      ordered: ['alias-beta'],
    });
  });

  test('tierFallbackOrder orders nearest tiers for each difficulty', () => {
    const tiers = {
      easy: 'm-easy',
      standard: 'm-std',
      hard: 'm-hard',
      ordered: ['m-easy', 'm-std', 'm-hard'],
    };
    expect(tierFallbackOrder(tiers, 'easy')).toEqual(['m-easy', 'm-std', 'm-hard']);
    expect(tierFallbackOrder(tiers, 'standard')).toEqual(['m-std', 'm-hard', 'm-easy']);
    expect(tierFallbackOrder(tiers, 'hard')).toEqual(['m-hard', 'm-std', 'm-easy']);
  });
});
