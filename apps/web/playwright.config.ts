import { defineConfig } from '@playwright/test';

// Issue #75 AC3: the reject-loop interaction chain walks client-side over
// the fixture script (`?scenario=chain`), so the e2e runs against the
// fixture-mode build — the only production-grade build in which the
// scenario parameter stays live (#58 gate).
// #137: E2E_PORT lets parallel worktree lanes preview on their own port —
// 8399 is machine-wide, and reuseExistingServer would otherwise silently
// test whichever lane's build answered first. Default unchanged.
const PORT = Number(process.env.E2E_PORT ?? 8399);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 732 },
    // #129: a boot without stored theme follows the system scheme — pin the
    // e2e system scheme to dark so the storage-less specs keep their dark
    // default; the follow-system behavior itself is asserted per-test via
    // page.emulateMedia in shell-consistency.spec.ts.
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
