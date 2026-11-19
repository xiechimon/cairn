import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { admitTestRun } from '../../scripts/test-admission.mjs';

await admitTestRun();

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      { find: /^cn$/, replacement: fileURLToPath(new URL('./src/lib/cn.ts', import.meta.url)) },
    ],
  },
  test: {
    fsModuleCache: true,
    include: ['test/**/*.test.ts'],
  },
});
