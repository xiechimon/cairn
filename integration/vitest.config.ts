import { defineConfig } from 'vitest/config';
import { admitTestRun } from '../scripts/test-admission.mjs';

await admitTestRun();

export default defineConfig({
  test: {
    setupFiles: ['./test/tmpdir-cleanup-setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
