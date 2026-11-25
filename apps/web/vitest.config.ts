import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { assertLocalTestRunAllowed, testRunWorkers } from '../../scripts/test-admission.mjs';

assertLocalTestRunAllowed('vitest');
const workers = await testRunWorkers();

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      { find: /^cn$/, replacement: fileURLToPath(new URL('./src/lib/cn.ts', import.meta.url)) },
    ],
  },
  test: {
    fsModuleCache: true,
    maxWorkers: workers,
    include: ['test/**/*.test.ts'],
  },
});
