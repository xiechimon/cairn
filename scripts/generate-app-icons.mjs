#!/usr/bin/env node

// App icon assets from one spiral path: a cream spiral over a moss tile in 4x4 ordered-dither dots, flat below 64px.
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
const MOSS_DEEP = '#244b32';
const MOSS = '#6f9c5f';
const SPIRAL_PATH =
  'M0 0 A84 84 0 0 1 168 0 A140 140 0 0 1 -112 0 A196 196 0 0 1 280 0 A252 252 0 0 1 -224 0 A308 308 0 0 1 392 0';
const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const svg = (body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${defs}${body}</svg>\n`;

const SHADOW =
  '<defs><filter id="lift" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#0a1910" flood-opacity="0.45"/></filter></defs>';

const spiral = (scale, lifted) =>
  `<g transform="translate(512 512) scale(${scale}) translate(-84 28)"${lifted ? ' filter="url(#lift)"' : ''}><path d="${SPIRAL_PATH}" fill="none" stroke="${CREAM}" stroke-width="58" stroke-linecap="round"/></g>`;

function ditherDots(x0, y0, size, cell) {
  const dots = [];
  const gap = Math.max(1, cell * 0.18);
  for (let j = 0; j * cell < size; j += 1) {
    for (let i = 0; i * cell < size; i += 1) {
      const fromBottom = 1 - (j * cell) / size;
      const fromLeft = 1 - (i * cell) / size;
      const tone = 0.15 + 0.8 * fromBottom * (0.4 + 0.6 * fromLeft);
      if (tone > ((BAYER_4[j % 4]?.[i % 4] ?? 0) + 0.5) / 16)
        dots.push(
          `<rect x="${x0 + i * cell}" y="${y0 + j * cell}" width="${cell - gap}" height="${cell - gap}"/>`,
        );
    }
  }
  return `<g fill="${MOSS}">${dots.join('')}</g>`;
}

const tile = (cell) => {
  const clip =
    '<clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>';
  const base = `<rect x="100" y="100" width="824" height="824" rx="185" fill="${MOSS_DEEP}"/>`;
  if (cell == null) return svg(`${base}${spiral(0.9, false)}`);
  return svg(
    `${base}<g clip-path="url(#tile)">${ditherDots(100, 100, 824, cell)}</g>${spiral(0.9, true)}`,
    `${SHADOW}<defs>${clip}</defs>`,
  );
};
const fullBleed = (cell) => {
  const base = `<rect width="1024" height="1024" fill="${MOSS_DEEP}"/>`;
  if (cell == null) return svg(`${base}${spiral(0.72, false)}`);
  return svg(`${base}${ditherDots(0, 0, 1024, cell)}${spiral(0.72, true)}`, SHADOW);
};

const cellFor = (px) => (px >= 256 ? 26 : px >= 128 ? 40 : px >= 64 ? 64 : null);

const MARK_PATH = SPIRAL_PATH.split(' A').slice(0, 4).join(' A');
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-142 -254 452 452" width="16" height="16"><path d="${MARK_PATH}" fill="none" stroke="#000" stroke-width="58" stroke-linecap="round"/></svg>\n`;

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

await write(join(ASSETS_DIR, 'AppIcon-1024.png'), await png(tile(cellFor(1024)), 1024));

for (const size of [192, 512]) {
  await write(join(PUBLIC_DIR, `icon-${size}.png`), await png(tile(cellFor(size)), size));
  await write(
    join(PUBLIC_DIR, `icon-maskable-${size}.png`),
    await png(fullBleed(cellFor(size)), size),
  );
  await write(join(PUBLIC_DIR, `icon-${size}-dark.png`), await png(fullBleed(cellFor(size)), size));
  await write(
    join(PUBLIC_DIR, `icon-${size}-light.png`),
    await png(fullBleed(cellFor(size)), size),
  );
}

writeFileSync(join(PUBLIC_DIR, 'logo.svg'), tile(null));
writeFileSync(join(ROOT, 'site/logo.svg'), tile(null));
writeFileSync(join(PUBLIC_DIR, 'logo-mark.svg'), MARK);
console.log('wrote apps/web/public/logo.svg, site/logo.svg, logo-mark.svg');

const iconset = join(mkdtempSync(join(tmpdir(), 'cairn-icon-')), 'AppIcon.iconset');
mkdirSync(iconset);
for (const base of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${base}x${base}.png`), await png(tile(cellFor(base)), base));
  writeFileSync(
    join(iconset, `icon_${base}x${base}@2x.png`),
    await png(tile(cellFor(base * 2)), base * 2),
  );
}
await browser.close();
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(ASSETS_DIR, 'AppIcon.icns')]);
rmSync(join(iconset, '..'), { recursive: true, force: true });
console.log('wrote assets/AppIcon.icns');
