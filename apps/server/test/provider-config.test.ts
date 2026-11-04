import { describe, expect, test } from 'vitest';
import type { StepCredentialBundle } from '../src/services/credentials.js';
import { toProviderConfig } from '../src/services/machines.js';

const BUNDLE: StepCredentialBundle['provider'] = {
  providerId: 'stub-gw',
  label: 'Stub Gateway',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: {},
  apiKey: 'sk-stub',
  models: [{ id: 'stub-model', name: 'stub-model' }],
  modelId: 'stub-model',
};

describe('toProviderConfig (spec 17 A4: runtime identity ships no provider)', () => {
  test('failure mode 1: runtime identity (claude-code) + no provider row -> null', () => {
    expect(toProviderConfig(null, 'claude-code')).toBeNull();
  });

  test('failure mode 2: a non-runtime custom id + no provider row -> api_key fallback, original semantics', () => {
    expect(toProviderConfig(null, 'stub-gw')).toEqual({
      kind: 'api_key',
      providerId: 'stub-gw',
    });
  });

  test('failure mode 3: agent provider null -> null, original semantics', () => {
    expect(toProviderConfig(null, null)).toBeNull();
  });

  test('failure mode 4: a bundle provider present -> the http projection, original semantics (apiKey passed through)', () => {
    expect(toProviderConfig(BUNDLE, null)).toEqual({
      kind: 'http',
      providerId: 'stub-gw',
      label: 'Stub Gateway',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      authHeader: true,
      compat: {},
      models: [{ id: 'stub-model', name: 'stub-model' }],
      apiKey: 'sk-stub',
    });
  });

  test('failure mode 5: a bundle present + runtime identity -> the http projection (bundle precedence untouched)', () => {
    expect(toProviderConfig(BUNDLE, 'claude-code')?.kind).toBe('http');
  });
});
