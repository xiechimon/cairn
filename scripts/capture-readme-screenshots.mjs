#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:5273';
const OUT_DIR = resolve(fileURLToPath(new URL('../docs/assets/readme', import.meta.url)));
const SCALE = 2;

const SHOTS = [
  { name: 'hero', query: '&thread=readme-export', width: 1440, height: 800, radius: 12 },
  {
    name: 'work',
    query: '&thread=readme-export',
    width: 390,
    height: 760,
    radius: 28,
    scrollTop: true,
  },
  { name: 'report', query: '&thread=readme-export', width: 390, height: 760, radius: 28 },
];

const BORDER = { light: 'rgba(0, 0, 0, 0.14)', dark: 'rgba(255, 255, 255, 0.16)' };

async function frame(page, png, radius, border) {
  return page.evaluate(
    async ({ src, radius, border, scale }) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      const r = radius * scale;
      const inset = scale / 2;
      context.beginPath();
      context.roundRect(0, 0, canvas.width, canvas.height, r);
      context.clip();
      context.drawImage(image, 0, 0);
      context.beginPath();
      context.roundRect(
        inset,
        inset,
        canvas.width - 2 * inset,
        canvas.height - 2 * inset,
        r - inset,
      );
      context.lineWidth = scale;
      context.strokeStyle = border;
      context.stroke();
      return canvas.toDataURL('image/webp', 0.86);
    },
    { src: `data:image/png;base64,${png.toString('base64')}`, radius, border, scale: SCALE },
  );
}

const browser = await chromium.launch();
const framer = await browser.newPage();
for (const locale of ['en', 'zh']) {
  for (const theme of ['light', 'dark']) {
    for (const shot of SHOTS) {
      const context = await browser.newContext({
        viewport: { width: shot.width, height: shot.height },
        deviceScaleFactor: SCALE,
        colorScheme: theme,
      });
      await context.addInitScript(
        ([themeValue, localeValue]) => {
          localStorage.setItem('cairn-theme', themeValue);
          localStorage.setItem('cairn.locale', localeValue);
        },
        [theme, locale],
      );
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/app?scenario=readme-${locale}${shot.query}`, {
        waitUntil: 'networkidle',
      });
      await page.addStyleTag({
        content: '.fixture-mode-chip, [data-testid="jump-to-latest"] { display: none !important; }',
      });
      await page.waitForTimeout(1200);
      if (shot.scrollTop) {
        await page.evaluate(() => {
          for (const element of document.querySelectorAll('*')) {
            if (element.scrollHeight > element.clientHeight + 4) element.scrollTop = 0;
          }
        });
        await page.waitForTimeout(400);
      }
      const png = await page.screenshot();
      const dataUrl = await frame(framer, png, shot.radius, BORDER[theme]);
      const file = resolve(OUT_DIR, `${shot.name}-${locale}-${theme}.webp`);
      writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(file);
      await context.close();
    }
  }
}
await browser.close();
