import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/tmpdir-cleanup-setup.ts'],
  },
});
