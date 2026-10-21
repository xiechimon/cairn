// Dumps the detail chip popover's innerHTML on fixture-mode pages: the three
// assigned-agent captures (r3-legacy-1 on 01, scenarios 19 and 29) and two
// unassigned todos (22d, r8-82).
// Usage: node fixture-dom-dump.mjs <baseURL> <out.json> <webAppDir>
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [base, out, webDir] = process.argv.slice(2);
const { chromium } = createRequire(join(webDir, 'package.json'))('@playwright/test');

const DETAILS = [
  ['/app/todo/r3-legacy-1?scenario=01', 'click'],
  ['/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=19', 'open'],
  ['/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=29', 'open'],
  ['/app/todo/r7-dark-fresh-probe-10?scenario=22d', 'click'],
  ['/app/todo/r8-delete-17?scenario=r8-82', 'click'],
];

const browser = await chromium.launch();
const result = {};
for (const [path, mode] of DETAILS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 }, colorScheme: 'dark' });
  await page.goto(base + path);
  await page.getByTestId('phase-chip').waitFor();
  if (mode === 'click') await page.getByTestId('phase-chip').click();
  const popover = page.getByRole('dialog', { name: '任务分配' });
  await popover.waitFor();
  await page.waitForTimeout(300);
  result[`${path} :: chip-popover`] = await popover.evaluate((el) => el.innerHTML);
  result[`${path} :: agent-row-text`] = await popover
    .locator('[data-selected] [data-row-kind="agent"]')
    .innerText();
  await page.close();
}
await browser.close();
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`${Object.keys(result).length} dumps -> ${out}`);
