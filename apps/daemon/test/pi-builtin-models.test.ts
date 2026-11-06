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
});
