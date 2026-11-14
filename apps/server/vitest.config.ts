import { defineConfig } from 'vitest/config';
import { admitTestRun } from '../../scripts/test-admission.mjs';

await admitTestRun();

export default defineConfig({
  test: {
    setupFiles: ['./test/tmpdir-cleanup-setup.ts'],
    testTimeout: 20_000,
  },
});
