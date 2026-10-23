#!/usr/bin/env node

// App icon assets from one spiral path (final design b2: cream tile, deep-green spiral).
// The macOS tile is Apple's 824/1024 body; macOS 26 masks icons to that shape, so the corners must match.
// Run: node scripts/generate-app-icons.mjs  (macOS only: AppIcon.icns needs iconutil; PNGs render through Playwright Chromium)

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire as requireFrom } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PUBLIC_DIR = join(ROOT, 'apps/web/public');
const ASSETS_DIR = join(ROOT, 'assets');

const CREAM = '#f2ead7';
const GREEN = '#173a2f';
const SPIRAL_PATH =
  'M0 0 A84 84 0 0 1 168 0 A140 140 0 0 1 -112 0 A196 196 0 0 1 280 0 A252 252 0 0 1 -224 0 A308 308 0 0 1 392 0';

const spiral = (scale, stroke) =>
  `<g transform="translate(512 512) scale(${scale}) translate(-84 28)"><path d="${SPIRAL_PATH}" fill="none" stroke="${stroke}" stroke-width="52" stroke-linecap="round"/></g>`;
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${body}</svg>\n`;

const TILE = svg(
  `<rect x="100" y="100" width="824" height="824" rx="185" fill="${CREAM}"/>${spiral(0.9, GREEN)}`,
);
const FULL_BLEED = svg(`<rect width="1024" height="1024" fill="${CREAM}"/>${spiral(0.72, GREEN)}`);
const MARK = svg(spiral(0.9, '#000'));

const { chromium } = requireFrom(join(ROOT, 'apps/web/package.json'))('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage();

async function png(markup, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

async function write(path, buffer) {
  writeFileSync(path, buffer);
  console.log(`wrote ${path.slice(ROOT.length)}`);
}

await write(join(ASSETS_DIR, 'AppIcon-1024.png'), await png(TILE, 1024));

for (const size of [192, 512]) {
  await write(join(PUBLIC_DIR, `icon-${size}.png`), await png(TILE, size));
  await write(join(PUBLIC_DIR, `icon-maskable-${size}.png`), await png(FULL_BLEED, size));
  await write(join(PUBLIC_DIR, `icon-${size}-dark.png`), await png(FULL_BLEED, size));
  await write(join(PUBLIC_DIR, `icon-${size}-light.png`), await png(FULL_BLEED, size));
}

writeFileSync(join(PUBLIC_DIR, 'logo.svg'), TILE);
writeFileSync(join(PUBLIC_DIR, 'logo-mark.svg'), MARK);
console.log('wrote apps/web/public/logo.svg, logo-mark.svg');

const iconset = join(mkdtempSync(join(tmpdir(), 'pacman-icon-')), 'AppIcon.iconset');
mkdirSync(iconset);
for (const base of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${base}x${base}.png`), await png(TILE, base));
  writeFileSync(join(iconset, `icon_${base}x${base}@2x.png`), await png(TILE, base * 2));
}
await browser.close();
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(ASSETS_DIR, 'AppIcon.icns')]);
rmSync(join(iconset, '..'), { recursive: true, force: true });
console.log('wrote assets/AppIcon.icns');
