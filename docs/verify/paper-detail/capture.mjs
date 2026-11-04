// Task detail evidence (paper-redesign-plan PR 7): light and dark captures
// of a running, a failed and a completed task from a fixture bundle served
// by `vite preview`.
//   node docs/verify/paper-detail/capture.mjs <label> <baseUrl>
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
  { name: 'running', url: '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=26' },
  { name: 'failed', url: '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=54' },
  { name: 'completed', url: '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36' },
];

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const shot of shots) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    const page = await context.newPage();
    await page.goto(`${base}${shot.url}`);
    await page.locator('[data-route="todo-detail"]').waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${label}-${theme}-${shot.name}.png`) });
    await context.close();
  }
}
await browser.close();
