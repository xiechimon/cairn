import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: new URL('./src', import.meta.url).pathname },
      { find: /^cn$/, replacement: new URL('./src/lib/cn.ts', import.meta.url).pathname },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['../../scripts/tmpdir-setup.mjs'],
  },
});
