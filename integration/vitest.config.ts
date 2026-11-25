import { defineConfig } from 'vitest/config';
import { assertLocalTestRunAllowed, testRunWorkers } from '../scripts/test-admission.mjs';

assertLocalTestRunAllowed('vitest');
const workers = await testRunWorkers();

export default defineConfig({
  test: {
    fsModuleCache: true,
    maxWorkers: workers,
    setupFiles: ['./test/tmpdir-cleanup-setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
