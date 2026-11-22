import { defineConfig } from 'vitest/config';
import { testRunWorkers } from '../scripts/test-admission.mjs';

const workers = await testRunWorkers();

export default defineConfig({
  test: {
    fsModuleCache: true,
    maxWorkers: workers,
    setupFiles: ['./test/tmpdir-cleanup-setup.ts', './test/antigravity-offline-setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
