#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:8392';
const OUT_DIR = resolve(fileURLToPath(new URL('../apps/web/public/screenshots', import.meta.url)));
const THEME_KEY = 'cairn-theme';
mkdirSync(OUT_DIR, { recursive: true });

const SHOTS = [
  { name: 'narrow', width: 780, height: 1688, scrollRight: true },
  { name: 'wide', width: 2560, height: 1600 },
];

async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolveDone) => {
        const cap = setTimeout(() => resolveDone(null), 2000);
        let quiet = 0;
        const wait = () => {
          const live = document.getAnimations().filter((anim) => {
            const timing = anim.effect?.getTiming();
            return timing?.iterations !== Infinity && anim.playState !== 'finished';
          });
          if (live.length === 0) {
            quiet += 1;
            if (quiet >= 4) {
              clearTimeout(cap);
              requestAnimationFrame(() => resolveDone(null));
            } else {
              requestAnimationFrame(wait);
            }
            return;
          }
          quiet = 0;
          Promise.all(live.map((anim) => anim.finished.catch(() => null))).then(wait);
        };
        wait();
      }),
  );
}

const browser = await chromium.launch();
for (const shot of SHOTS) {
  const context = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(
    ([key, theme]) => localStorage.setItem(key, theme),
    [THEME_KEY, 'dark'],
  );
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/app?scenario=01`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  if (shot.scrollRight) {
    await page.evaluate(() => {
      const el = document.querySelector('.board-scroller');
      if (el == null) throw new Error('no .board-scroller element for scrollRight shot');
      el.scrollLeft = el.scrollWidth - el.clientWidth;
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  }
  const png = await page.screenshot();
  writeFileSync(resolve(OUT_DIR, `${shot.name}.png`), png);
  console.log(`wrote screenshots/${shot.name}.png (${shot.width}x${shot.height})`);
  await context.close();
}
await browser.close();
