import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const ROOTS = ['apps/web/src', 'apps/server/src', 'apps/daemon/src', 'packages/shared/src'];

function listSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  for (const root of ROOTS) walk(join(REPO_ROOT, root));
  return out;
}

function filesMatching(pattern: RegExp): string[] {
  return listSources()
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(REPO_ROOT, file))
    .sort();
}

describe('cross-workspace shared helper single-source guards', () => {
  test('isValidFileName is defined only in packages/shared/src/attachment-types.ts', () => {
    expect(filesMatching(/\bfunction\s+isValidFileName\b/)).toEqual([
      'packages/shared/src/attachment-types.ts',
    ]);
  });

  test('localDay is defined only in packages/shared/src/records/daily-usage.ts', () => {
    expect(filesMatching(/\bfunction\s+localDay\b/)).toEqual([
      'packages/shared/src/records/daily-usage.ts',
    ]);
  });

  test('escapeRegExp is defined only in packages/shared/src/text.ts', () => {
    expect(filesMatching(/\b(?:function\s+escapeRegExp\b|const\s+escapeRegExp\s*=)/)).toEqual([
      'packages/shared/src/text.ts',
    ]);
  });

  test('pid liveness check lives only in packages/shared/src/node/parent-watch.ts', () => {
    expect(filesMatching(/\bfunction\s+(?:pidAlive|processAlive)\b/)).toEqual([
      'packages/shared/src/node/parent-watch.ts',
    ]);
  });

  test('wrappedBy is defined only in packages/shared/src/records/prompts.ts', () => {
    expect(filesMatching(/\bfunction\s+wrappedBy\b/)).toEqual([
      'packages/shared/src/records/prompts.ts',
    ]);
  });

  test('tool JSON-schema object builder is not copy-pasted across protocol files', () => {
    expect(filesMatching(/\bconst\s+obj\s*=\s*\(properties:\s*Record<string,\s*unknown>/)).toEqual(
      [],
    );
  });

  test('apps/server/src/lib/hash.ts delegates to sha256Hex instead of duplicating node:crypto', () => {
    const hashSource = readFileSync(join(REPO_ROOT, 'apps/server/src/lib/hash.ts'), 'utf8');
    expect(hashSource).not.toContain('node:crypto');
    expect(hashSource).toContain('sha256Hex');
  });
});
