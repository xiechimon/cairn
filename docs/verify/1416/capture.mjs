// Skills list divider evidence (#1416), light and dark, 1440x900 at DPR 2,
// from a fixture build served by `vite preview`.
//   node docs/verify/1416/capture.mjs <label> <baseUrl>
// label = before | after. Scenario skills-list renders three clickable skill
// rows (ResourceRow with onOpen = a Button per row). Also writes
// <label>-metrics.json with each row's border widths and colors.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [label, base] = process.argv.slice(2);
if (!label || !base) throw new Error('usage: capture.mjs <label> <baseUrl>');
const out = dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });

const metrics = {};
const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await context.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
  const page = await context.newPage();
  await page.goto(`${base}/app/resources/skills?scenario=skills-list`);
  await page.getByTestId('resource-row').nth(2).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${label}-${theme}-skills.png`) });
  // A close crop of the card so the 1px rules are visible at a glance.
  await page
    .getByTestId('resource-group')
    .screenshot({ path: join(out, `${label}-${theme}-skills-card.png`) });
  metrics[theme] = {
    border: await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--border)';
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }),
    rows: await page.getByTestId('resource-row').evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName,
          top: cs.borderTopWidth,
          bottom: cs.borderBottomWidth,
          bottomColor: cs.borderBottomColor,
        };
      }),
    ),
  };
  await context.close();
}
await browser.close();
writeFileSync(join(out, `${label}-metrics.json`), `${JSON.stringify(metrics, null, 2)}\n`);
