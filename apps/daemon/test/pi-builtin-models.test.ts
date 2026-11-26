import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderConfig } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { materializeProvider } from '../src/backend/pi.js';
import { testTempDir } from './test-temp-dir.js';

function materialized(provider: ProviderConfig): Record<string, unknown> {
  const path = join(testTempDir('cairn-builtin-'), 'models.json');
  materializeProvider(path, provider);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    providers: Record<string, Record<string, unknown>>;
  };
  const entry = raw.providers[provider.providerId];
  if (entry === undefined) throw new Error('provider not materialized');
  return entry;
}

const ANTHROPIC: ProviderConfig = {
  kind: 'http',
  providerId: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  api: 'anthropic-messages',
  authHeader: false,
  models: [
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', contextWindow: 1_000_000 },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', contextWindow: 1_000_000 },
  ],
};

describe('models pi already ships stay pi built-ins', () => {
  test('an Anthropic provider listing only catalog models writes no model overrides, so reasoning and thinking levels come from pi', () => {
    const entry = materialized(ANTHROPIC);
    expect(entry).toMatchObject({
      baseUrl: 'https://api.anthropic.com',
      api: 'anthropic-messages',
    });
    expect(entry).not.toHaveProperty('models');
  });

  test('a model the built-in provider lacks is still declared', () => {
    const entry = materialized({
      ...ANTHROPIC,
      models: [...(ANTHROPIC.models ?? []), { id: 'claude-relay-preview', name: 'Preview' }],
    });
    expect(entry.models).toEqual([expect.objectContaining({ id: 'claude-relay-preview' })]);
  });

  test('a custom provider id keeps every model it lists', () => {
    const entry = materialized({ ...ANTHROPIC, providerId: 'my-relay' });
    expect((entry.models as { id: string }[]).map((m) => m.id)).toEqual([
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
    ]);
  });

  test('a preset id aliased to a pi catalog provider declares models with the catalog reasoning flags', () => {
    const entry = materialized({
      kind: 'http',
      providerId: 'z-ai',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      api: 'openai-completions',
      models: [{ id: 'glm-5.3', name: 'GLM 5.3' }],
    });
    expect(entry.models).toEqual([
      expect.objectContaining({
        id: 'glm-5.3',
        reasoning: true,
        thinkingLevelMap: expect.objectContaining({ low: 'low', high: 'high', max: 'max' }),
        compat: expect.objectContaining({
          thinkingFormat: 'zai',
          supportsReasoningEffort: true,
        }),
      }),
    ]);
  });

  test('an aliased preset model the catalog lacks keeps custom defaults', () => {
    const entry = materialized({
      kind: 'http',
      providerId: 'z-ai',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      api: 'openai-completions',
      models: [{ id: 'glm-next-preview', name: 'Preview' }],
    });
    expect(entry.models).toEqual([
      expect.objectContaining({ id: 'glm-next-preview', reasoning: false }),
    ]);
  });

  test('a custom anthropic-messages endpoint inherits reasoning, thinkingLevelMap, compat, contextWindow and cost for known models while unknown models stay reasoning: false', () => {
    const entry = materialized({
      kind: 'http',
      providerId: 'anthropic-ultra',
      baseUrl: 'https://ultra.example.com',
      api: 'anthropic-messages',
      models: [
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
        { id: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
        { id: 'foo-custom-model', name: 'Custom Model' },
      ],
    });
    expect(entry.models).toEqual([
      expect.objectContaining({
        id: 'claude-opus-5-5',
        reasoning: true,
        contextWindow: 1_000_000,
        thinkingLevelMap: expect.objectContaining({
          off: null,
          low: 'low',
          medium: 'medium',
          high: 'high',
          xhigh: 'xhigh',
          max: 'max',
        }),
        compat: expect.objectContaining({
          forceAdaptiveThinking: true,
          supportsMidConvoEffort: true,
        }),
      }),
      expect.objectContaining({
        id: 'anthropic/claude-sonnet-5-5',
        reasoning: true,
        contextWindow: 1_000_000,
        thinkingLevelMap: expect.objectContaining({ xhigh: 'xhigh', max: 'max' }),
      }),
      expect.objectContaining({
        id: 'foo-custom-model',
        reasoning: false,
      }),
    ]);
    const opus = (entry.models as { id: string; cost: { input: number } }[])[0];
    expect(opus?.cost.input).toBeGreaterThan(0);
  });
});
