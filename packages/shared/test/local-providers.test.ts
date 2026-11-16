import { describe, expect, test } from 'vitest';
import { piProviderImports, piProviders } from '../src/local-providers.js';

const relay = (apiKey?: string) => ({
  name: 'Relay',
  api: 'openai-completions',
  baseUrl: 'https://relay.example.com/v1',
  ...(apiKey === undefined ? {} : { apiKey }),
  models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b' }],
});

const states = (models: unknown, auth: unknown = {}) =>
  Object.fromEntries(piProviders(models, auth).map((p) => [p.providerId, p.state]));

describe('piProviders', () => {
  test('a literal key in models.json is ready, with its metadata', () => {
    expect(piProviders({ providers: { relay: relay('sk-literal') } }, {})).toEqual([
      {
        source: 'pi',
        providerId: 'relay',
        label: 'Relay',
        api: 'openai-completions',
        baseUrl: 'https://relay.example.com/v1',
        authHeader: false,
        models: [
          { id: 'model-a', name: 'Model A' },
          { id: 'model-b', name: 'model-b' },
        ],
        state: 'ready',
      },
    ]);
  });

  test('the scan never carries key material', () => {
    const scanned = JSON.stringify(
      piProviders(
        { providers: { a: relay('sk-in-models'), b: relay() } },
        { b: { type: 'api_key', key: 'sk-in-auth' } },
      ),
    );
    expect(scanned).not.toContain('sk-in-models');
    expect(scanned).not.toContain('sk-in-auth');
  });

  test('every key form maps to its state', () => {
    expect(
      states(
        {
          providers: {
            literal: relay('sk-1'),
            envName: relay('$RELAY_KEY'),
            envBraced: relay(['$', '{RELAY_KEY}'].join('')),
            command: relay('!security find-generic-password -ws relay'),
            missing: relay(),
            fromAuth: relay(),
            oauth: relay('sk-ignored'),
            unknownApi: { ...relay('sk-2'), api: 'google-generative-ai' },
            badUrl: { ...relay('sk-3'), baseUrl: 'file:///etc' },
            noModels: { ...relay('sk-4'), models: [] },
          },
        },
        {
          fromAuth: { type: 'api_key', key: 'sk-auth' },
          oauth: { type: 'oauth', access: 'x', refresh: 'y' },
          codex: { type: 'oauth' },
          deepseek: { type: 'api_key', key: 'sk-builtin' },
        },
      ),
    ).toEqual({
      literal: 'ready',
      envName: 'needs-key',
      envBraced: 'needs-key',
      command: 'needs-key',
      missing: 'needs-key',
      fromAuth: 'ready',
      oauth: 'needs-login',
      unknownApi: 'unsupported',
      badUrl: 'unsupported',
      noModels: 'unsupported',
      codex: 'needs-login',
      deepseek: 'needs-key',
    });
  });

  test('malformed files yield nothing instead of throwing', () => {
    expect(piProviders(null, null)).toEqual([]);
    expect(piProviders({ providers: 'x' }, 'x')).toEqual([]);
    expect(piProviders({ providers: { bad: 3 } }, { bad: 3 })).toEqual([]);
  });
});

describe('piProviderImports', () => {
  test('returns keys only for requested ready providers, auth.json first', () => {
    const imports = piProviderImports(
      { providers: { a: relay('sk-models'), b: relay('$ENV'), c: relay('sk-c') } },
      { a: { type: 'api_key', key: 'sk-auth' } },
      ['a', 'b'],
    );
    expect(imports.map((i) => [i.providerId, i.apiKey])).toEqual([['a', 'sk-auth']]);
  });

  test('Pi escapes resolve to the literal characters', () => {
    const [only] = piProviderImports({ providers: { a: relay('k$$1$!2') } }, {}, ['a']);
    expect(only?.apiKey).toBe('k$1!2');
  });
});
