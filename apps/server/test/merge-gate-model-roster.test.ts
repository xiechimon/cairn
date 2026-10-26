import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { canonicalModelId, modelVendor } from '../src/services/merge-gate/model-identity.js';
import { deriveModelRoster, type RosterModel } from '../src/services/merge-gate/model-roster.js';
import { MODEL_ALIASES, MODEL_VENDORS } from '../src/services/merge-gate/model-roster-data.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CATALOG_DIR = join(
  REPO_ROOT,
  'apps/daemon/node_modules/@earendil-works/pi-ai/dist/providers/data',
);

describe('merge-gate model roster', () => {
  test('the checked-in snapshot matches the installed pi model catalogs', () => {
    const catalogs = readdirSync(CATALOG_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const raw: unknown = JSON.parse(readFileSync(join(CATALOG_DIR, name), 'utf8'));
        const models: RosterModel[] = [];
        if (typeof raw === 'object' && raw !== null) {
          for (const group of Object.values(raw)) {
            if (typeof group !== 'object' || group === null) continue;
            for (const model of Object.values(group)) {
              if (typeof model === 'object' && model !== null && 'id' in model) {
                const id = model.id;
                if (typeof id === 'string') models.push(model as RosterModel);
              }
            }
          }
        }
        return { provider: name.slice(0, -'.json'.length), models };
      });
    expect(deriveModelRoster(catalogs)).toEqual({
      vendors: MODEL_VENDORS,
      aliases: MODEL_ALIASES,
    });
  });

  test('relay aliases and spellings resolve to one upstream id and vendor', () => {
    expect(canonicalModelId('radius/balanced[1m]')).toBe('kimi-k3');
    expect(canonicalModelId('precise')).toBe('gpt-5.6-sol');
    expect(canonicalModelId('cheap')).toBe('deepseek-v4.1-flash');
    expect(canonicalModelId('anthropic/claude-opus-5-5[1M]')).toBe('claude-opus-5-5');
    expect(modelVendor('balanced')).toBe('Moonshot');
    expect(modelVendor('google/gemini-2.5-pro')).toBe('Google');
    expect(modelVendor('not-a-real-model')).toBeNull();
  });
});
