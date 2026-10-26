import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../scripts/tmpdir-setup.mjs'],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    // vite build empties apps/web/dist first, so files that each run it must not run in parallel (#349).
    fileParallelism: false,
  },
});
