import { defineConfig } from 'vitest/config';
import { testRunWorkers } from '../../scripts/test-admission.mjs';

const workers = await testRunWorkers();

export default defineConfig({
  test: {
    fsModuleCache: true,
    maxWorkers: workers,
  },
});
