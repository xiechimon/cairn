// Board sheet evidence (paper-redesign-plan PR 7): light and dark captures
// of the board next to a PageShell route and the full-bleed detail route,
// from a fixture bundle served by `vite preview`.
//   node docs/verify/paper-board-sheet/capture.mjs <label> <baseUrl>
// label = before | after; baseUrl = a preview of `vite build --mode fixture`.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [label, base] = process.argv.slice(2);
if (!label || !base) throw new Error('usage: capture.mjs <label> <baseUrl>');
const out = dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });

const shots = [
  { name: 'board', url: '/app?scenario=01' },
  { name: 'board-rail', url: '/app?scenario=01', rail: true },
  { name: 'chief-settings', url: '/app?scenario=101' },
  { name: 'schedules', url: '/app/schedules?scenario=11' },
  { name: 'detail', url: '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=detail-unread' },
];

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const shot of shots) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(
      ([t, rail]) => {
        localStorage.setItem('pacman-theme', t);
        if (rail) localStorage.setItem('pacman.sidebar-collapsed', '1');
      },
      [theme, shot.rail === true],
    );
    const page = await context.newPage();
    await page.goto(`${base}${shot.url}`);
    await page.locator('.board-sidebar').waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${label}-${theme}-${shot.name}.png`) });
    await context.close();
  }
}
await browser.close();
