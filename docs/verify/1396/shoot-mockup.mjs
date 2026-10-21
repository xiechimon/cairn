#!/usr/bin/env node
// Renders the six views of apps/web/docs/board-paper-dark.html to PNG and
// reports any in-page contrast cell that fails its gate.
//   node docs/verify/1396/shoot-mockup.mjs
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const html = resolve(here, '../../../apps/web/docs/board-paper-dark.html');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const names = ['board', 'detail', 'settings', 'dialog', 'menu', 'tokens'];
let fails = [];
for (let i = 0; i < names.length; i++) {
  await page.goto(`file://${html}?v=${i + 1}&picker=0`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(here, `mockup-${i + 1}-${names[i]}.png`) });
  if (names[i] === 'tokens') {
    fails = await page.evaluate(() =>
      [...document.querySelectorAll('.ratio.fail')].map((e) => e.parentElement.textContent),
    );
  }
}
console.log(JSON.stringify({ errors, fails }));
await browser.close();
