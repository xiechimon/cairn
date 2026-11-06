import { afterAll } from 'vitest';
import { cleanupTestTempDirs } from '../../../scripts/test-tmpdir.mjs';

afterAll(() => {
  cleanupTestTempDirs();
});
