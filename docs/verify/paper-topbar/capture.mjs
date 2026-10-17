// Board top bar evidence (paper-redesign-plan PR 4): light-theme captures of
// the board header from two fixture bundles served by `vite preview`.
//   node docs/verify/paper-topbar/capture.mjs <label> <baseUrl>
// label = before | after; baseUrl = a preview of `vite build --mode fixture`.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [label, base] = process.argv.slice(2);
if (!label || !base) throw new Error('usage: capture.mjs <label> <baseUrl>');
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixture');
mkdirSync(out, { recursive: true });

const shots = [
  { name: 'n-pending', url: '/app?scenario=01', width: 1440 },
  { name: 'n-zero', url: '/app?scenario=board-tags-empty', width: 1440 },
  { name: 'filter-active', url: '/app?scenario=board-repos&projects=r2-inventory', width: 1440 },
  {
    name: 'filter-open',
    url: '/app?scenario=board-repos&projects=r2-inventory',
    width: 1440,
    open: true,
  },
  { name: 'narrow-720', url: '/app?scenario=01', width: 720 },
  { name: 'compact', url: '/app?scenario=01', width: 1440, density: 'compact' },
  // No fixture holds hundreds of 待处理 cards: this one rewrites the rendered
  // count in the DOM to check the truncation path only (after bundle only).
  { name: 'narrow-720-dom-n12840', url: '/app?scenario=01', width: 720, bigN: '12840' },
];

const browser = await chromium.launch();
for (const shot of shots) {
  const context = await browser.newContext({
    viewport: { width: shot.width, height: 732 },
    deviceScaleFactor: 2,
  });
  await context.addInitScript((density) => {
    localStorage.setItem('pacman-theme', 'light');
    if (density) localStorage.setItem('pacman-density', density);
  }, shot.density ?? null);
  const page = await context.newPage();
  await page.goto(`${base}${shot.url}`);
  await page.locator('.board-column').first().waitFor();
  if (shot.bigN) {
    const count = page.getByTestId('needs-you').locator('.font-semibold');
    if ((await count.count()) === 0) {
      await context.close();
      continue;
    }
    await count.evaluate((el, n) => {
      el.textContent = n;
    }, shot.bigN);
  }
  if (shot.open) {
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    await page.getByRole('dialog', { name: '筛选' }).waitFor();
  }
  await page.waitForTimeout(300);
  const height = shot.open ? 420 : 160;
  await page.screenshot({
    path: join(out, `${label}-${shot.name}.png`),
    clip: { x: 0, y: 0, width: shot.width, height },
  });
  await context.close();
}
await browser.close();
