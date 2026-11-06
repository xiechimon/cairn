import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import * as schema from '../src/db/schema.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SOURCE_DIRS = [
  'apps/server/src',
  'apps/daemon/src',
  'apps/coordinator/src',
  'packages/shared/src',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

const RAW_AGENT_TABLE = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+[`"']?agent[`"']?\s/i;
const AGENT_TABLE_IMPORT = /import\s*\{[^}]*\bagent\b[^}]*\}\s*from\s*'[^']*db\/schema(?:\.js)?'/;
const AGENT_TABLE_MEMBER = /\bschema\.agent\b/;
const ASSIGNMENT_COLUMN = /\btodo\.assignment\b|\bchief\.agentId\b|\badoptedAgentIds\b/;

describe('nothing references the tables and columns dropped with the agent layer', () => {
  test('the schema exports no agent table and the removed columns', () => {
    expect('agent' in schema).toBe(false);
    expect('assignment' in schema.todo).toBe(false);
    expect('agentId' in schema.chief).toBe(false);
    expect('adoptedAgentIds' in schema.routingRule).toBe(false);
  });

  test('no source file queries the agent table or the dropped columns', () => {
    const offenders: string[] = [];
    for (const file of SOURCE_DIRS.flatMap(sourceFiles)) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const [name, pattern] of [
        ['raw agent table', RAW_AGENT_TABLE],
        ['agent table import', AGENT_TABLE_IMPORT],
        ['schema.agent', AGENT_TABLE_MEMBER],
        ['dropped column', ASSIGNMENT_COLUMN],
      ] as const) {
        if (pattern.test(text)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
