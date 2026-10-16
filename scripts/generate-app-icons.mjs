#!/usr/bin/env node

// App icon assets from two hand-drawn pixel grids (design: Doop canvas DJIx3ExrCm, 6b).
// Sizes >= 32 scale the 32x32 grid by a whole number; 16 px uses the 16x16 grid,
// so no size ever resamples a pixel. The macOS tile is Apple's 824/1024 body with
// continuous corners; macOS 26 masks icons to that shape, so the corners must match.
// Run: node scripts/generate-app-icons.mjs  (macOS only: AppIcon.icns needs iconutil)

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname;
const PUBLIC_DIR = join(ROOT, 'apps/web/public');
const ASSETS_DIR = join(ROOT, 'assets');

// # = body, o = eye, * = pellet
const SPRITE_32 = [
  '.....######......',
  '...##########....',
  '..###########....',
  '.######oo###.....',
  '.######oo##......',
  '##########.......',
  '#########........',
  '########...**..**',
  '########...**..**',
  '#########........',
  '##########.......',
  '.##########......',
  '.###########.....',
  '..###########....',
  '...##########....',
  '.....######......',
];
const ORIGIN_32 = { x: 8, y: 8 };

const SPRITE_16 = [
  '..####.....',
  '.##o##.....',
  '#####......',
  '####..**.**',
  '####..**.**',
  '#####......',
  '.#####.....',
  '..####.....',
];
const ORIGIN_16 = { x: 3, y: 4 };

const INK = [43, 38, 32];
const PAPER = [243, 238, 229];
const DARK = { base: INK, body: [208, 99, 55], eye: INK, pellet: PAPER };
const LIGHT = { base: PAPER, body: [180, 83, 42], eye: PAPER, pellet: INK };

// ---- raster ----

function canvas(size) {
  return { size, data: Buffer.alloc(size * size * 4) };
}

function fillAll(c, rgb) {
  for (let i = 0; i < c.data.length; i += 4) {
    c.data[i] = rgb[0];
    c.data[i + 1] = rgb[1];
    c.data[i + 2] = rgb[2];
    c.data[i + 3] = 255;
  }
}

function setPixel(c, x, y, rgb) {
  const i = (y * c.size + x) * 4;
  c.data[i] = rgb[0];
  c.data[i + 1] = rgb[1];
  c.data[i + 2] = rgb[2];
  c.data[i + 3] = 255;
}

function drawSprite(c, palette) {
  const small = c.size < 32;
  const rows = small ? SPRITE_16 : SPRITE_32;
  const origin = small ? ORIGIN_16 : ORIGIN_32;
  const cell = small ? c.size / 16 : c.size / 32;
  if (!Number.isInteger(cell))
    throw new Error(`size ${c.size} is not a whole multiple of the grid`);
  const ink = { '#': palette.body, o: palette.eye, '*': palette.pellet };
  rows.forEach((row, gy) => {
    [...row].forEach((ch, gx) => {
      const rgb = ink[ch];
      if (!rgb) return;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          setPixel(c, (origin.x + gx) * cell + x, (origin.y + gy) * cell + y, rgb);
        }
      }
    });
  });
}

// Continuous-corner rounded rect (the UIBezierPath "continuous" corner, PaintCode
// reconstruction), flattened to a polygon in 1024-space.
function squirclePolygon() {
  const [x0, y0, x1, y1, r] = [100, 100, 924, 924, 185];
  const corners = [
    (a, b) => [x1 - a * r, y0 + b * r],
    (a, b) => [x1 - b * r, y1 - a * r],
    (a, b) => [x0 + a * r, y1 - b * r],
    (a, b) => [x0 + b * r, y0 + a * r],
  ];
  const pts = [];
  const cubic = (p0, p1, p2, p3) => {
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const u = 1 - t;
      pts.push(
        [0, 1].map(
          (k) => u ** 3 * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t ** 3 * p3[k],
        ),
      );
    }
  };
  for (const C of corners) {
    const start = C(1.52866471, 0);
    pts.push(start);
    cubic(start, C(1.08849323, 0), C(0.86840689, 0), C(0.66993427, 0.065496));
    pts.push(C(0.63149399, 0.074911));
    cubic(
      pts.at(-1),
      C(0.37282392, 0.16905899),
      C(0.16906013, 0.37282401),
      C(0.07491176, 0.63149399),
    );
    cubic(pts.at(-1), C(0, 0.86840701), C(0, 1.08849299), C(0, 1.52866483));
  }
  return pts;
}

// Anti-aliased fill of a convex polygon: 16 sub-scanlines per row, exact horizontal coverage.
function fillConvex(c, poly, rgb) {
  const scale = c.size / 1024;
  const P = poly.map(([x, y]) => [x * scale, y * scale]);
  const cov = new Float64Array(c.size * c.size);
  const SUB = 16;
  for (let y = 0; y < c.size; y++) {
    for (let s = 0; s < SUB; s++) {
      const sy = y + (s + 0.5) / SUB;
      const xs = [];
      for (let i = 0; i < P.length; i++) {
        const [ax, ay] = P[i];
        const [bx, by] = P[(i + 1) % P.length];
        if (ay <= sy !== by <= sy) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      if (xs.length < 2) continue;
      const left = Math.max(0, Math.min(...xs));
      const right = Math.min(c.size, Math.max(...xs));
      for (let x = Math.floor(left); x < Math.ceil(right); x++) {
        const w = Math.min(x + 1, right) - Math.max(x, left);
        if (w > 0) cov[y * c.size + x] += w / SUB;
      }
    }
  }
  for (let p = 0; p < cov.length; p++) {
    const a = Math.min(1, cov[p]);
    if (a <= 0) continue;
    const i = p * 4;
    c.data[i] = rgb[0];
    c.data[i + 1] = rgb[1];
    c.data[i + 2] = rgb[2];
    c.data[i + 3] = Math.round(a * 255);
  }
}

const SQUIRCLE = squirclePolygon();

function appIcon(size) {
  const c = canvas(size);
  fillConvex(c, SQUIRCLE, DARK.base);
  drawSprite(c, DARK);
  return c;
}

function fullBleed(size, palette) {
  const c = canvas(size);
  fillAll(c, palette.base);
  drawSprite(c, palette);
  return c;
}

// ---- PNG encode (8-bit RGBA, non-interlaced) ----

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function encodePng({ size, data }) {
  const chunk = (type, payload) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(payload.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(path, c) {
  writeFileSync(path, encodePng(c));
  console.log(`wrote ${path.slice(ROOT.length)} (${c.size}x${c.size})`);
}

// ---- logo.svg: the 16-grid glyph as pixel-aligned rects, eye left as a hole ----

function logoSvg() {
  const rects = [];
  SPRITE_16.forEach((row, gy) => {
    for (let gx = 0; gx < row.length; ) {
      if (row[gx] === '#' || row[gx] === '*') {
        let end = gx;
        while (end < row.length && row[end] === row[gx]) end++;
        rects.push(
          `<rect x="${ORIGIN_16.x + gx}" y="${ORIGIN_16.y + gy}" width="${end - gx}" height="1"/>`,
        );
        gx = end;
      } else gx++;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">
  <style>
    .mark { fill: #b4532a; }
    @media (prefers-color-scheme: dark) { .mark { fill: #d06337; } }
  </style>
  <g class="mark">
    ${rects.join('\n    ')}
  </g>
</svg>
`;
}

// ---- outputs ----

write(join(ASSETS_DIR, 'AppIcon-1024.png'), appIcon(1024));

for (const size of [192, 512]) {
  write(join(PUBLIC_DIR, `icon-${size}.png`), appIcon(size));
  write(join(PUBLIC_DIR, `icon-maskable-${size}.png`), fullBleed(size, DARK));
  write(join(PUBLIC_DIR, `icon-${size}-dark.png`), fullBleed(size, DARK));
  write(join(PUBLIC_DIR, `icon-${size}-light.png`), fullBleed(size, LIGHT));
}

writeFileSync(join(PUBLIC_DIR, 'logo.svg'), logoSvg());
console.log('wrote apps/web/public/logo.svg (16x16 grid)');

const iconset = join(mkdtempSync(join(tmpdir(), 'pacman-icon-')), 'AppIcon.iconset');
mkdirSync(iconset);
for (const base of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${base}x${base}.png`), encodePng(appIcon(base)));
  writeFileSync(join(iconset, `icon_${base}x${base}@2x.png`), encodePng(appIcon(base * 2)));
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(ASSETS_DIR, 'AppIcon.icns')]);
rmSync(join(iconset, '..'), { recursive: true, force: true });
console.log('wrote assets/AppIcon.icns');
