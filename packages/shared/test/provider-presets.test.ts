import { describe, expect, test } from 'vitest';
import { derivePresetDefaults, newestPerFamily } from '../src/records/provider-presets.js';

describe('provider preset derivation', () => {
  test('newest per family: version digits and date suffixes do not split a family', () => {
    const models = [
      'claude-sonnet-5-5',
      'claude-sonnet-4-5-20250929',
      'o4-mini',
      'o3-mini',
      'qwen3.8-max',
      'qwen3.10-max',
      'gpt-6.1-mini',
      'gpt-6.1',
    ].map((id) => ({ id, name: id }));
    expect(newestPerFamily(models)).toEqual([
      'claude-sonnet-5-5',
      'o4-mini',
      'qwen3.10-max',
      'gpt-6.1-mini',
      'gpt-6.1',
    ]);
  });

  test('a provider spread over several protocols picks the route with the most chat models', () => {
    const model = (id: string, api: string, baseUrl: string, type = 'chat') => ({
      id,
      name: id,
      api,
      baseUrl,
      type,
    });
    const out = derivePresetDefaults([
      {
        provider: 'fireworks',
        models: [
          model('a', 'anthropic-messages', 'https://x/inference'),
          model('b', 'openai-completions', 'https://x/inference/v1'),
          model('c', 'openai-completions', 'https://x/inference/v1'),
          model('d', 'anthropic-messages', 'https://x/inference', 'image'),
          model('e', 'anthropic-messages', 'https://x/inference', 'image'),
        ],
      },
      { provider: 'google', models: [model('g', 'google-generative-ai', 'https://g')] },
    ]);
    expect(out.fireworks).toEqual({
      baseUrl: 'https://x/inference/v1',
      api: 'openai-completions',
      authHeader: false,
      models: [
        { id: 'c', name: 'c' },
        { id: 'b', name: 'b' },
      ],
      picks: ['c', 'b'],
    });
    expect(out.google).toBeUndefined();
  });
});
