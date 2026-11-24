import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVER_SERVICES = join(REPO_ROOT, 'apps/server/src/services');

function serviceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(SERVER_SERVICES);
  return out;
}

function matching(pattern: RegExp, skip = new Set<string>()): string[] {
  return serviceFiles()
    .map((file) => ({ file, rel: relative(REPO_ROOT, file) }))
    .filter(({ rel }) => !skip.has(rel))
    .filter(({ file }) => pattern.test(readFileSync(file, 'utf8')))
    .map(({ rel }) => rel)
    .sort();
}

describe('server service deduplication guards', () => {
  test('claimRateWindow lives only in subscription-helpers.ts', () => {
    expect(matching(/\bfunction\s+claimRateWindow\b/)).toEqual([
      'apps/server/src/services/subscription-helpers.ts',
    ]);
  });

  test('refuseWhileRunning lives only in subscription-helpers.ts', () => {
    expect(matching(/\bfunction\s+refuseWhileRunning\b/)).toEqual([
      'apps/server/src/services/subscription-helpers.ts',
    ]);
  });

  test('tool guard helpers live in tool-guards.ts (except security-surface mcp-face.ts)', () => {
    const securitySurface = new Set(['apps/server/src/services/mcp-face.ts']);
    expect(
      matching(
        /\bfunction\s+(?:requireTeamTodo|teamTodo|requireTodo|requireProjectRow|requireTeamBuild)\b/,
        securitySurface,
      ),
    ).toEqual(['apps/server/src/services/tool-guards.ts']);
  });

  test('collectLines lives only in acp-probe.ts', () => {
    expect(matching(/\bfunction\s+collectLines\b/)).toEqual([
      'apps/server/src/services/acp-probe.ts',
    ]);
  });
});
