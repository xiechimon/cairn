import type { ProviderConfig } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { resolveStepProvider } from '../src/step-provider.js';

const credential = {
  kind: 'api_key',
  providerId: 'team-anthropic',
  label: 'Team',
} as ProviderConfig;

describe('resolveStepProvider', () => {
  test('a backend runtime agent uses the runtime as provider and ignores the credential', () => {
    expect(resolveStepProvider('claude-code', credential)).toEqual({
      runtimeId: 'claude-code',
      provider: { kind: 'api_key', providerId: 'claude-code' },
    });
  });

  test('an API agent prefers the pushed credential provider', () => {
    expect(resolveStepProvider('anthropic', credential)).toEqual({
      runtimeId: null,
      provider: credential,
    });
  });

  test('without a pushed credential the agent provider becomes an api_key provider', () => {
    expect(resolveStepProvider('openai', null)).toEqual({
      runtimeId: null,
      provider: { kind: 'api_key', providerId: 'openai' },
    });
  });

  test('no agent provider and no credential leaves the step without a provider', () => {
    expect(resolveStepProvider(null, null)).toEqual({ runtimeId: null, provider: null });
    expect(resolveStepProvider(undefined, null)).toEqual({ runtimeId: null, provider: null });
  });
});
