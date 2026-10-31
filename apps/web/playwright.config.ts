import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8399);

export default defineConfig({
  testDir: './e2e',
  globalSetup: resolve(import.meta.dirname, 'e2e/port-holder-guard.ts'),
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 732 },
    colorScheme: 'dark',
    locale: 'zh-CN',
  },
  webServer: {
    command: `pnpm exec vite build --mode fixture && pnpm exec vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/app`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
