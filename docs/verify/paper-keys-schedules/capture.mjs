// Paper API keys and schedules evidence: both pages empty and populated, and
// the 新建定时 dialog. Light and dark, 1440x900 at DPR 2, from a fixture
// build served by vite preview.
//   node docs/verify/paper-keys-schedules/capture.mjs <label> <baseUrl>
// label = before | after.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [label, base] = process.argv.slice(2);
if (!label || !base) throw new Error('usage: capture.mjs <label> <baseUrl>');
const out = dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });

const shots = [
  { name: 'api-keys-empty', url: '/app/api-keys' },
  { name: 'api-keys-list', url: '/app/api-keys?scenario=api-keys-created' },
  { name: 'schedules-empty', url: '/app/schedules?scenario=11' },
  { name: 'schedules-list', url: '/app/schedules?scenario=r3-93' },
  { name: 'dialog-schedule', url: '/app/schedules?scenario=r3-92', dialog: true },
];

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    await context.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    const page = await context.newPage();
    await page.goto(`${base}${shot.url}`);
    await page.locator('[data-testid="page-col"]').first().waitFor();
    if (shot.dialog) await page.getByRole('dialog').first().waitFor();
    await page.waitForFunction(() => [...document.images].every((img) => img.complete));
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${label}-${theme}-${shot.name}.png`) });
    await context.close();
  }
}
await browser.close();
