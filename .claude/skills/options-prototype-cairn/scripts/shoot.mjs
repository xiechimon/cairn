import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const [html, out = '/tmp/options-shots'] = process.argv.slice(2);
if (!html) {
  console.error('usage: node shoot.mjs <prototype.html> [outdir]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 780 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${path.resolve(html)}`);
const stateCount = await page.evaluate(() => STATES.length);
for (const opt of [1, 2, 3]) {
  for (let state = 0; state < stateCount; state++) {
    const name = await page.evaluate(
      ([o, s]) => {
        S.opt = o;
        S.state = s;
        S.adding = false;
        render();
        return `opt${o}-${STATES[s]}`;
      },
      [opt, state],
    );
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
}
await browser.close();
if (errors.length) {
  console.error('page errors:', errors);
  process.exit(1);
}
