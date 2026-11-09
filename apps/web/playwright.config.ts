import { defineConfig } from '@playwright/test';
import { slotPortReport, slotResources } from '../../scripts/heavy-slots.mjs';
import { admitTestRun } from '../../scripts/test-admission.mjs';

const lease = await admitTestRun();
const resources = lease === null ? null : slotResources(lease.slot, { ...process.env, E2E_PORT: process.env.E2E_PORT ?? '8399' });
const PORT = resources?.port ?? Number(process.env.E2E_PORT ?? 8399);
const buildFlags = resources ? `--outDir ${JSON.stringify(resources.distDir)}` : '';
if (resources && lease) {
  process.env.E2E_DIST_DIR = resources.distDir;
  if (process.env.TEST_WORKER_INDEX === undefined) {
    const conflict = slotPortReport({ slot: lease.slot, env: { ...process.env, E2E_PORT: process.env.E2E_PORT ?? '8399' } });
    if (conflict !== null) throw new Error(conflict);
    console.log(`[e2e] slot ${lease.slot}: E2E_PORT=${PORT}, build output ${resources.distDir}`);
  }
}

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/port-holder-guard.ts',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 732 },
    colorScheme: 'dark',
    locale: 'zh-CN',
  },
  webServer: {
    command: `pnpm exec vite build --mode fixture ${buildFlags} --emptyOutDir && pnpm exec vite preview ${buildFlags} --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/app`,
    reuseExistingServer: lease === null,
    timeout: 120_000,
  },
});
