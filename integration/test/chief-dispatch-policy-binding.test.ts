import { CHIEF_DISPATCH_HARNESS_PATHS, type CompareFile } from '@cairn/shared';
import { expect, test } from 'vitest';
import { touchesHarness } from '../../apps/server/src/services/merge-gate/paths.js';

for (const filename of [
  'integration/eval/chief-dispatch/infra-retry.mts',
  'integration/eval/adoption/judge.mts',
  'integration/eval/chief-dispatch/family-coverage.mts',
  'integration/eval/chief-dispatch/oracle-check.mts',
  'integration/eval/chief-dispatch/build-report-lite.mts',
]) {
  test(`harness approval and change detection include ${filename}`, () => {
    const file: CompareFile = {
      status: 'modified',
      filename,
      previousFilename: null,
      sha: 'a'.repeat(40),
      additions: 1,
      deletions: 1,
      patchSha: 'b'.repeat(64),
    };
    expect(CHIEF_DISPATCH_HARNESS_PATHS).toContain(filename);
    expect(touchesHarness([file])).toBe(true);
  });
}
