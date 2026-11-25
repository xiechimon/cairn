import { defineConfig } from 'vitest/config';
import { assertLocalTestRunAllowed, testRunWorkers } from '../../scripts/test-admission.mjs';

assertLocalTestRunAllowed('vitest');
const workers = await testRunWorkers();

export default defineConfig({
  test: {
    fsModuleCache: true,
    maxWorkers: workers,
    include: ['scripts/*.test.ts'],
    setupFiles: ['../../integration/test/tmpdir-cleanup-setup.ts'],
  },
});
