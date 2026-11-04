// Page shell merge evidence (paper-redesign-plan PR 6): light and dark
// captures of the non-board shells from a fixture bundle served by
// `vite preview`.
//   node docs/verify/paper-shell-merge/capture.mjs <label> <baseUrl>
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
  { name: 'schedules', url: '/app/schedules?scenario=11' },
  { name: 'resources-skills', url: '/app/resources/skills?scenario=06' },
  { name: 'team', url: '/app/team?scenario=12' },
  { name: 'project', url: '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=r2-24' },
  { name: 'agent-detail', url: '/app/resources/agents/r3-builder?scenario=agent-detail' },
];

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const shot of shots) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((t) => {
      localStorage.setItem('pacman-theme', t);
      localStorage.setItem('pacman.sidebarResourcesCollapsed', '0');
    }, theme);
    const page = await context.newPage();
    await page.goto(`${base}${shot.url}`);
    await page.getByRole('complementary').waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${label}-${theme}-${shot.name}.png`) });
    await context.close();
  }
}
await browser.close();
