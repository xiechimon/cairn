import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_DESC_MAX_LENGTH } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import { ensurePersonasSeeded } from '../src/services/personas.js';
import { bootServer } from './helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('skills named by the Implementer profile (#1406 P5-3)', () => {
  test('F11/F12: the seeded Implementer duty text stays within the length gate, and the named *-cairn skills all exist in this repo', () => {
    const s = bootServer();
    try {
      ensurePersonasSeeded(s.db, s.team.id);
      const row = s.db
        .select({ description: agentTable.description })
        .from(agentTable)
        .where(and(eq(agentTable.teamId, s.team.id), eq(agentTable.persona, 'implementer')))
        .get();
      const description = row?.description ?? '';
      expect(description.length).toBeLessThanOrEqual(AGENT_DESC_MAX_LENGTH);
      const named = [...new Set(description.match(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*-cairn\b/g))];
      expect(named).toEqual(expect.arrayContaining(['pr-cairn', 'verify-cairn']));
      for (const name of named) {
        expect(existsSync(join(REPO_ROOT, '.claude', 'skills', name, 'SKILL.md')), name).toBe(true);
      }
    } finally {
      s.dispose();
    }
  });
});
