import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CompareFile, PROTECTED_PATH_GLOBS } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { classifyPaths } from '../src/services/merge-gate/paths.js';

const compareFile = (filename: string, over: Partial<CompareFile> = {}): CompareFile => ({
  filename,
  previousFilename: null,
  status: 'modified',
  sha: 'a'.repeat(40),
  patchSha: 'b'.repeat(64),
  additions: 1,
  deletions: 1,
  ...over,
});

describe('adoption evaluator protection', () => {
  test.each([
    'integration/eval/adoption/judge.mts',
    'integration/eval/adoption/sealed-ledger.mts',
    'integration/eval/adoption/future-evaluator.mts',
  ])('%s requires human review, including a rename away', (path) => {
    expect(classifyPaths([compareFile(path)], '1605').protected).toContain(path);
    expect(
      classifyPaths(
        [
          compareFile('apps/server/src/ordinary.ts', {
            previousFilename: path,
            status: 'renamed',
          }),
        ],
        '1605',
      ).protected,
    ).toContain(path);
  });

  test('the eval ruler globs cover the adoption judge and spec 29 names it', () => {
    for (const glob of [
      'integration/eval/**',
      '.claude/hillclimb/**',
      'apps/server/src/trajectory-export.ts',
      'apps/server/src/trajectory-export-cli.ts',
      'apps/server/src/trajectory-outcome.ts',
      'packages/shared/src/trajectory-pack.ts',
    ])
      expect(PROTECTED_PATH_GLOBS).toContain(glob);
    const spec = readFileSync(
      join(import.meta.dirname, '../../../docs/spec/29-evaluation-and-data-loop.md'),
      'utf8',
    );
    expect(spec).toContain('integration/eval/adoption/judge.mts');
    expect(spec).toContain('#1605');
  });
});
