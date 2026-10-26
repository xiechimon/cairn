import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../../scripts/tmpdir-setup.mjs'],
  },
});
