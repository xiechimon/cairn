#!/usr/bin/env node
// PWA manifest screenshots capture (素材替换计划 §3.2 / D8, #249): the two
// manifest `screenshots` entries ship real captures of the UI at the sizes
// the manifest declares (narrow 780×1688, wide 2560×1600). Run against a
// fixture-mode build so the ?scenario= fixture parameter stays live:
//
//   pnpm --filter @cairn/web exec vite build --mode fixture
//   pnpm --filter @cairn/web exec vite preview --host 127.0.0.1 --port 8392 --strictPort &
//   node scripts/capture-pwa-screenshots.mjs http://127.0.0.1:8392
//
// (--host 127.0.0.1: vite preview binds IPv6-only by default and the
// 127.0.0.1 base URL then never connects)
//
// Writes apps/web/public/screenshots/{narrow,wide}.png (the manifest srcs).

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:8392';
// fileURLToPath, not .pathname — percent-decodes spaces in the checkout path
const OUT_DIR = resolve(fileURLToPath(new URL('../apps/web/public/screenshots', import.meta.url)));
const THEME_KEY = 'cairn-theme'; // apps/web/src/theme.ts THEME_STORAGE_KEY
mkdirSync(OUT_DIR, { recursive: true });

const SHOTS = [
  // narrow folds the populated 执行中 column past the viewport — scroll the
  // board rail right so the capture shows cards, not two empty columns
  { name: 'narrow', width: 780, height: 1688, scrollRight: true },
  { name: 'wide', width: 2560, height: 1600 },
];

/** Settle: finite animations finished (2s cap). */
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
