import { defineConfig } from '@playwright/test';

const BASE = process.env.PR_SCREENS_BASE ?? 'pr-screens-base';

export default defineConfig({
  testDir: './pr-screens',
  testMatch: 'compare.spec.ts',
  outputDir: 'pr-screens-results',
  snapshotPathTemplate: `${BASE}/{arg}{ext}`,
  updateSnapshots: 'none',
  retries: 0,
  reporter: [['json', { outputFile: 'pr-screens-results/results.json' }], ['line']],
});
