import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderCompat, ProviderConfig } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanupTestDirs, makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { adaptProviderCompat, materializeProvider } from '../src/backend/pi.js';

const dirs: string[] = [];
afterEach(() => cleanupTestDirs(dirs.splice(0)));

function tempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  dirs.push(dir);
  return dir;
}

const RELAY_400 = '400: {"message":"Model does not support this protocol.","type":"server_error"}';

function gateway(providerId: string, compat?: ProviderConfig['compat']): ProviderConfig {
  return {
    kind: 'http',
    providerId,
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
    ...(compat !== undefined ? { compat } : {}),
  };
}

function loadCompat(path: string, providerId: string): ProviderCompat | undefined {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    providers: Record<string, { compat?: ProviderCompat }>;
  };
  return raw.providers[providerId]?.compat;
}

describe('materializeProvider config changes take effect immediately (#708 failure mode 3)', () => {
  test('failure mode 1: server compat deletes the knob the learning slot filled → learning voided, old shape does not flow back', () => {
    const dir = tempDir('cairn-cfg');
    const path = join(dir, 'models.json');
    adaptProviderCompat(gateway('cfg-remove'), RELAY_400);
    materializeProvider(path, gateway('cfg-remove'));
    expect(loadCompat(path, 'cfg-remove')).toEqual({
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
    materializeProvider(path, gateway('cfg-remove', { supportsDeveloperRole: false }));
    expect(loadCompat(path, 'cfg-remove')).toEqual({ supportsDeveloperRole: false });
  });

  test('failure mode 2: server compat unchanged → learning fills the slot as before (tuition paid once, zero regression)', () => {
    const dir = tempDir('cairn-cfg');
    const path = join(dir, 'models.json');
    adaptProviderCompat(gateway('cfg-stable'), RELAY_400);
    materializeProvider(path, gateway('cfg-stable'));
    materializeProvider(path, gateway('cfg-stable'));
    expect(loadCompat(path, 'cfg-stable')).toEqual({
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
  });

  test('failure mode 3: after voiding, hitting the error again → can relearn (voiding is not a permanent ban)', () => {
    const dir = tempDir('cairn-cfg');
    const path = join(dir, 'models.json');
    adaptProviderCompat(gateway('cfg-relearn'), RELAY_400);
    materializeProvider(path, gateway('cfg-relearn'));
    expect(loadCompat(path, 'cfg-relearn')).toEqual({
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
    materializeProvider(path, gateway('cfg-relearn', { supportsDeveloperRole: false }));
    expect(loadCompat(path, 'cfg-relearn')).toEqual({ supportsDeveloperRole: false });
    const amended = adaptProviderCompat(
      gateway('cfg-relearn', { supportsDeveloperRole: false }),
      RELAY_400,
    );
    expect(amended?.compat).toEqual({
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
    materializeProvider(path, gateway('cfg-relearn', { supportsDeveloperRole: false }));
    expect(loadCompat(path, 'cfg-relearn')).toEqual({
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
  });

  test('failure mode 4: server compat explicitly rewrites the knob value → materialization takes the new explicit value', () => {
    const dir = tempDir('cairn-cfg');
    const path = join(dir, 'models.json');
    adaptProviderCompat(gateway('cfg-rewrite'), RELAY_400);
    materializeProvider(path, gateway('cfg-rewrite'));
    materializeProvider(path, gateway('cfg-rewrite', { maxTokensField: 'max_completion_tokens' }));
    expect(loadCompat(path, 'cfg-rewrite')?.maxTokensField).toBe('max_completion_tokens');
  });
});

describe('materializeProvider cost declaration slot (#927)', () => {
  function providerWith(providerId: string, models: ProviderConfig['models']): ProviderConfig {
    return { ...gateway(providerId), models };
  }
  function loadModels(path: string, providerId: string): Record<string, unknown>[] {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      providers: Record<string, { models?: Record<string, unknown>[] }>;
    };
    return raw.providers[providerId]?.models ?? [];
  }

  test('model declares cost → models.json entry = declared price (overrides the zero default)', () => {
    const dir = tempDir('cairn-cost');
    const path = join(dir, 'models.json');
    materializeProvider(
      path,
      providerWith('cost-gw', [
        { id: 'm1', name: 'M1', cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
      ]),
    );
    expect(loadModels(path, 'cost-gw')[0]).toMatchObject({
      id: 'm1',
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    });
  });

  test('price undeclared → zero-price default unchanged (zero regression for existing materialized output)', () => {
    const dir = tempDir('cairn-cost');
    const path = join(dir, 'models.json');
    materializeProvider(path, providerWith('cost-none', [{ id: 'm2', name: 'M2' }]));
    expect(loadModels(path, 'cost-none')[0]).toMatchObject({
      id: 'm2',
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });
});

describe('materializeProvider context/output cap declaration slots (#1526)', () => {
  function providerWith(providerId: string, models: ProviderConfig['models']): ProviderConfig {
    return { ...gateway(providerId), models };
  }
  function loadModels(path: string, providerId: string): Record<string, unknown>[] {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      providers: Record<string, { models?: Record<string, unknown>[] }>;
    };
    return raw.providers[providerId]?.models ?? [];
  }

  test('model declares contextWindow=1000000 → models.json entry = declared value (1M context no longer truncated by the 128k default)', () => {
    const dir = tempDir('cairn-ctxwin');
    const path = join(dir, 'models.json');
    materializeProvider(
      path,
      providerWith('ctx-gw', [
        { id: 'glm-5.3', name: 'glm-5.3', contextWindow: 1_000_000, maxTokens: 32_768 },
      ]),
    );
    expect(loadModels(path, 'ctx-gw')[0]).toMatchObject({
      id: 'glm-5.3',
      contextWindow: 1_000_000,
      maxTokens: 32_768,
    });
  });

  test('undeclared → 128k/16k defaults unchanged (behavior unchanged when unconfigured)', () => {
    const dir = tempDir('cairn-ctxwin');
    const path = join(dir, 'models.json');
    materializeProvider(path, providerWith('ctx-none', [{ id: 'm2', name: 'M2' }]));
    expect(loadModels(path, 'ctx-none')[0]).toMatchObject({
      id: 'm2',
      contextWindow: 128_000,
      maxTokens: 16_384,
    });
  });

  test('two models on one provider with only one declaring → overrides are per-model, no cross-talk', () => {
    const dir = tempDir('cairn-ctxwin');
    const path = join(dir, 'models.json');
    materializeProvider(
      path,
      providerWith('ctx-mixed', [
        { id: 'big', name: 'Big', contextWindow: 1_000_000 },
        { id: 'small', name: 'Small' },
      ]),
    );
    const models = loadModels(path, 'ctx-mixed');
    expect(models[0]).toMatchObject({ id: 'big', contextWindow: 1_000_000, maxTokens: 16_384 });
    expect(models[1]).toMatchObject({ id: 'small', contextWindow: 128_000, maxTokens: 16_384 });
  });
});
