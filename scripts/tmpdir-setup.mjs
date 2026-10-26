import { afterAll } from 'vitest';
import { cleanupAllTestDirs } from './test-tmpdir.mjs';

afterAll(() => {
  cleanupAllTestDirs();
});
