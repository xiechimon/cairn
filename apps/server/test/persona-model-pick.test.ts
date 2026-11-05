import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import { ensurePersonasSeeded } from '../src/services/personas.js';
import { bootServer, insertMachine } from './helpers.js';

const sources = ['../src/services/dispatch-timeouts.ts', '../src/services/personas.ts'];

function seededModels(s: ReturnType<typeof bootServer>): string[] {
  ensurePersonasSeeded(s.db, s.team.id);
  return s.db
    .select()
    .from(agentTable)
    .all()
    .filter((row) => row.persona !== null && row.modelId !== null)
    .map((row) => row.modelId as string);
}

describe('service sources (#2741)', () => {
  test('no non-null assertion and no biome-ignore suppression', () => {
    for (const path of sources) {
      const text = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(text, path).not.toContain('biome-ignore');
      expect(text.match(/[A-Za-z0-9_)\]]!(?!=)/g) ?? [], path).toEqual([]);
    }
  });
});

describe('persona model pick (#2741)', () => {
  test('prefers the reported default slot', () => {
    const s = bootServer();
    insertMachine(s, {
      name: 'mea-default',
      claudeCodeReport: {
        installed: true,
        hostname: 'test',
        models: [
          { id: 'large-1', name: 'large-1', slot: 'large' },
          { id: 'default-1', name: 'default-1', slot: 'default' },
        ],
        auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
      },
    });
    expect(new Set(seededModels(s))).toEqual(new Set(['default-1']));
    s.dispose();
  });

  test('falls back to the first reported model when no slot is default', () => {
    const s = bootServer();
    insertMachine(s, {
      name: 'mea-noslot',
      claudeCodeReport: {
        installed: true,
        hostname: 'test',
        models: [
          { id: 'first-1', name: 'first-1', slot: 'large' },
          { id: 'second-1', name: 'second-1', slot: 'small' },
        ],
        auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
      },
    });
    expect(new Set(seededModels(s))).toEqual(new Set(['first-1']));
    s.dispose();
  });

  test('seeds no model when the report lists none and no provider is known', () => {
    const s = bootServer();
    insertMachine(s, {
      name: 'mea-empty',
      claudeCodeReport: {
        installed: true,
        hostname: 'test',
        models: [],
        auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
      },
    });
    ensurePersonasSeeded(s.db, s.team.id);
    const withModel = s.db
      .select()
      .from(agentTable)
      .all()
      .filter((row) => row.persona !== null && row.modelId !== null);
    expect(withModel).toEqual([]);
    s.dispose();
  });
});
