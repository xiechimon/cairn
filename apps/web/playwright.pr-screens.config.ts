import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8399);

export default defineConfig({
  testDir: './pr-screens',
  testMatch: 'capture.shots.ts',
  outputDir: 'pr-screens-results',
  fullyParallel: true,
  workers: 3,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
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
