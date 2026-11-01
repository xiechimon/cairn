#!/usr/bin/env node

// Brand assets from one hand-drawn spiral, outlined to a single filled path: the mark, the favicon tile, and app icons with a moss tile in 4x4 ordered-dither dots (flat below 64px).
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
const MARK_STROKE = 0.085;

function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function spiralCentreline() {
  const random = seeded(7);
  const jitter = Array.from({ length: 10 }, () => (random() - 0.5) * 2);
  const points = [];
  const samples = 220;
  for (let i = 0; i <= samples; i += 1) {
    const u = i / samples;
    const angle = u * 2.35 * Math.PI * 2;
    const band = Math.floor(u * 8);
    const blend = (u * 8) % 1;
    const wobble = (jitter[band] ?? 0) * (1 - blend) + (jitter[band + 1] ?? 0) * blend;
    const radius = (0.1 + u ** 1.18 * 0.36) * (1 + 0.035 * wobble);
    points.push([Math.cos(angle - Math.PI / 2) * radius, Math.sin(angle - Math.PI / 2) * radius]);
  }
  const last = points[points.length - 1];
  const before = points[points.length - 6];
  const dx = last[0] - before[0];
  const dy = last[1] - before[1];
  const length = Math.hypot(dx, dy);
  const tx = dx / length;
  const ty = dy / length;
  for (let i = 1; i <= 30; i += 1) {
    const u = i / 30;
    points.push([
      last[0] + tx * 0.32 * 0.42 * u - ty * 0.6 * 0.06 * u * u,
      last[1] + ty * 0.32 * 0.42 * u + tx * 0.6 * 0.06 * u * u,
    ]);
  }
  return points;
}

const fixed = (n) => Number(n.toFixed(4));

function smoothThrough(points) {
  let d = '';
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    d += `C${fixed(p1[0] + (p2[0] - p0[0]) / 6)} ${fixed(p1[1] + (p2[1] - p0[1]) / 6)} ${fixed(p2[0] - (p3[0] - p1[0]) / 6)} ${fixed(p2[1] - (p3[1] - p1[1]) / 6)} ${fixed(p2[0])} ${fixed(p2[1])}`;
  }
  return d;
}

function outlinedMark() {
  const centre = spiralCentreline().filter((_, i, all) => i % 2 === 0 || i === all.length - 1);
  const half = MARK_STROKE / 2;
  const left = [];
  const right = [];
  centre.forEach((point, i) => {
    const a = centre[Math.max(0, i - 1)];
    const b = centre[Math.min(centre.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    left.push([point[0] - (dy / length) * half, point[1] + (dx / length) * half]);
    right.push([point[0] + (dy / length) * half, point[1] - (dx / length) * half]);
  });
  const back = right.reverse();
  const cap = (to) => `A${fixed(half)} ${fixed(half)} 0 0 0 ${fixed(to[0])} ${fixed(to[1])}`;
  const d = `M${fixed(left[0][0])} ${fixed(left[0][1])}${smoothThrough(left)}${cap(back[0])}${smoothThrough(back)}${cap(left[0])}Z`;
  const xs = centre.map((p) => p[0]);
  const ys = centre.map((p) => p[1]);
  const size =
    Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) +
    MARK_STROKE * 2;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return { d, viewBox: [fixed(cx - size / 2), fixed(cy - size / 2), fixed(size), fixed(size)] };
}

const MARK_GEOMETRY = outlinedMark();
const [VB_X, VB_Y, VB_SIZE] = MARK_GEOMETRY.viewBox;

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

const spiral = (span, lifted) => {
  const k = span / VB_SIZE;
  return `<g transform="translate(512 512) scale(${fixed(k)}) translate(${fixed(-(VB_X + VB_SIZE / 2))} ${fixed(-(VB_Y + VB_SIZE / 2))})"${lifted ? ' filter="url(#lift)"' : ''}><path d="${MARK_GEOMETRY.d}" fill="${CREAM}"/></g>`;
};

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
  if (cell == null) return svg(`${base}${spiral(640, false)}`);
  return svg(
    `${base}<g clip-path="url(#tile)">${ditherDots(100, 100, 824, cell)}</g>${spiral(640, true)}`,
    `${SHADOW}<defs>${clip}</defs>`,
  );
};
const fullBleed = (cell) => {
  const base = `<rect width="1024" height="1024" fill="${MOSS_DEEP}"/>`;
  if (cell == null) return svg(`${base}${spiral(520, false)}`);
  return svg(`${base}${ditherDots(0, 0, 1024, cell)}${spiral(520, true)}`, SHADOW);
};

const cellFor = (px) => (px >= 256 ? 26 : px >= 128 ? 40 : px >= 64 ? 64 : null);

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_GEOMETRY.viewBox.join(' ')}" width="16" height="16"><path d="${MARK_GEOMETRY.d}" fill="#000"/></svg>\n`;
const MARK_MODULE = `export const BRAND_MARK_VIEWBOX = [${MARK_GEOMETRY.viewBox.join(', ')}] as const;\n\nexport const BRAND_MARK_PATH =\n  '${MARK_GEOMETRY.d}';\n`;

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
writeFileSync(join(ROOT, 'apps/web/src/lib/brand-mark.ts'), MARK_MODULE);
console.log('wrote apps/web/public/logo.svg, site/logo.svg, logo-mark.svg, src/lib/brand-mark.ts');

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
