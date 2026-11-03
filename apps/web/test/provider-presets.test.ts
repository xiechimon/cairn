import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  AGGREGATOR_PRESET_IDS,
  derivePresetDefaults,
  MAX_DEFAULT_PICKS,
  PROVIDER_OAUTH_PRESET_IDS,
  PROVIDER_PRESET_IDS,
  type PresetCatalog,
  type PresetCatalogModel,
  providerModelSchema,
} from '@cairn/shared';
import { PROVIDER_PRESET_DEFAULTS } from '../src/resources/provider-preset-data.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CATALOG_DIR = join(
  REPO_ROOT,
  'apps/daemon/node_modules/@earendil-works/pi-ai/dist/providers/data',
);
const DATA_FILE = join(REPO_ROOT, 'apps/web/src/resources/provider-preset-data.ts');

function installedCatalogs(): PresetCatalog[] {
  return readdirSync(CATALOG_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const raw = JSON.parse(readFileSync(join(CATALOG_DIR, name), 'utf8')) as Record<
        string,
        Record<string, PresetCatalogModel>
      >;
      return {
        provider: name.slice(0, -'.json'.length),
        models: Object.values(raw).flatMap((group) => Object.values(group)),
      };
    });
}

const UNSPOKEN_PROTOCOL_PRESETS = ['amazon-bedrock', 'google', 'google-vertex', 'mistral'];

describe('provider preset defaults', () => {
  const derived = derivePresetDefaults(installedCatalogs());

  if (process.env.UPDATE_PROVIDER_PRESETS === '1') {
    writeFileSync(
      DATA_FILE,
      `import type { ProviderPresetDefaults } from '@cairn/shared';\n\nexport const PROVIDER_PRESET_DEFAULTS: Readonly<Record<string, ProviderPresetDefaults>> = ${JSON.stringify(derived, null, 2)};\n`,
    );
  }

  test('the checked-in snapshot matches the installed pi model catalogs (UPDATE_PROVIDER_PRESETS=1 rewrites it)', () => {
    expect(PROVIDER_PRESET_DEFAULTS).toEqual(derived);
  });

  test('anthropic fills the route the Coordinator keyed route requires', () => {
    const anthropic = PROVIDER_PRESET_DEFAULTS.anthropic;
    expect(anthropic).toMatchObject({
      baseUrl: 'https://api.anthropic.com',
      api: 'anthropic-messages',
      authHeader: false,
    });
    expect(new URL(anthropic?.baseUrl ?? '').hostname).toBe('api.anthropic.com');
    const byId = new Map(anthropic?.models.map((m) => [m.id, m]));
    for (const id of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']) {
      expect(byId.get(id)?.contextWindow).toBeGreaterThan(0);
    }
    expect(anthropic?.picks).toEqual([
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-haiku-5-5',
      'claude-fable-5-1',
    ]);
  });


  const oauth: readonly string[] = PROVIDER_OAUTH_PRESET_IDS;

  test.each(PROVIDER_PRESET_IDS.filter((id) => !oauth.includes(id)))('%s', (id) => {
    const defaults = PROVIDER_PRESET_DEFAULTS[id];
    if (UNSPOKEN_PROTOCOL_PRESETS.includes(id)) {
      expect(defaults).toBeUndefined();
      return;
    }
    expect(defaults).toBeDefined();
    if (defaults === undefined) return;
    expect(defaults.baseUrl).toMatch(/^https:\/\//);
    expect(defaults.authHeader).toBe(false);
    expect(defaults.models.length).toBeGreaterThan(0);
    for (const model of defaults.models) providerModelSchema.parse(model);
    const ids = defaults.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(defaults.picks.length).toBeLessThanOrEqual(MAX_DEFAULT_PICKS);
    for (const pick of defaults.picks) expect(ids).toContain(pick);
    if (AGGREGATOR_PRESET_IDS.includes(id)) expect(defaults.picks).toEqual([]);
  });

  test('oauth presets carry no key-form defaults', () => {
    for (const id of PROVIDER_OAUTH_PRESET_IDS)
      expect(PROVIDER_PRESET_DEFAULTS[id]).toBeUndefined();
  });

});
