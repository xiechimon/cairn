import { defineConfig } from '@playwright/test';
import { testRunPort } from '../../scripts/test-admission.mjs';

const EMPTY = await testRunPort(process.env.PR_SCREENS_EMPTY_PORT ?? 8441);
const SEEDED = await testRunPort(process.env.PR_SCREENS_SEEDED_PORT ?? 8443);

export default defineConfig({
  testDir: './pr-screens',
  testMatch: 'live.shots.ts',
  outputDir: 'pr-screens-results-live',
  fullyParallel: true,
  workers: 3,
  retries: 0,
  expect: { timeout: 15_000 },
  reporter: 'line',
  use: {
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    locale: 'zh-CN',
  },
  webServer: [
    {
      command: `node pr-screens/live-world.mjs ${EMPTY} empty`,
      url: `http://127.0.0.1:${Number(EMPTY) + 1}`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command: `node pr-screens/live-world.mjs ${SEEDED} seed`,
      url: `http://127.0.0.1:${Number(SEEDED) + 1}`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
