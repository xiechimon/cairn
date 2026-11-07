import { onTestFinished } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';

export function testTempDir(prefix: string): string {
  const directory = makeTestTempDir(prefix);
  onTestFinished(() => {
    releaseTestTempDir(directory);
  });
  return directory;
}
