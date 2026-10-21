// Dumps the ⌘K search panel innerHTML for a fixed set of fixture-mode
// pages and queries. Usage: node dump.mjs <baseURL> <out.json> <webAppDir>
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [base, out, webDir] = process.argv.slice(2);
const { chromium } = createRequire(join(webDir, 'package.json'))('@playwright/test');

const CASES = [
  ['/app?scenario=01', ['r3', 'lifecycle', 'probe', 'nomatch-zzz']],
  ['/app?scenario=board-repos', ['repofilter', 'r2', 'r3']],
  ['/app?scenario=newtask-projects', ['r3', 'r2']],
  ['/app/todo/r3-legacy-1?scenario=01', ['r3', 'lifecycle']],
  ['/app/team?scenario=01', ['r3', 'lifecycle']],
];

const browser = await chromium.launch();
const result = {};
for (const [path, queries] of CASES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 }, colorScheme: 'dark' });
  await page.goto(base + path);
  await page.getByRole('complementary').waitFor();
  const panel = page.getByRole('dialog', { name: '搜索' });
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Meta+k');
    if (await panel.waitFor({ state: 'visible', timeout: 1000 }).then(() => true, () => false)) break;
  }
  for (const q of queries) {
    await panel.getByRole('textbox').fill(q);
    await page.waitForTimeout(150);
    result[`${path} :: ${q}`] = await panel.evaluate((el) => el.innerHTML);
  }
  await page.close();
}
await browser.close();
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`${Object.keys(result).length} panel dumps -> ${out}`);
