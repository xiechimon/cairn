#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_ICON, ICNS_SLOTS, WEB_ICONS } from './logo.mjs';
import { decodePng, encodeIcns, encodePng } from './raster.mjs';

const ROOT = join(import.meta.dirname, '../..');
const ICTOOL =
  '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool';
const MACOS_BODY = 824 / 1024;
const BLEED_ZOOM = 1.2;
const scratch = mkdtempSync(join(tmpdir(), 'cairn-app-icon-'));

function render({ platform, rendition, px }) {
  const out = join(scratch, `${platform}-${rendition}-${px}.png`);
  execFileSync(ICTOOL, [
    join(ROOT, APP_ICON),
    '--export-image',
    '--output-file',
    out,
    '--platform',
    platform,
    '--rendition',
    rendition,
    '--width',
    String(px),
    '--height',
    String(px),
    '--scale',
    '1',
  ]);
  return decodePng(readFileSync(out));
}

function place(art, px, offset) {
  const pixels = Buffer.alloc(px * px * 4);
  const from = Math.max(0, offset);
  const to = Math.min(px, art.width + offset);
  for (let y = 0; y < px; y += 1) {
    const sy = y - offset;
    if (sy < 0 || sy >= art.height) continue;
    art.pixels.copy(
      pixels,
      (y * px + from) * 4,
      (sy * art.width + from - offset) * 4,
      (sy * art.width + to - offset) * 4,
    );
  }
  return encodePng({ width: px, height: px, pixels });
}

function macos(px) {
  const body = Math.round(px * MACOS_BODY);
  const art = render({ platform: 'macOS', rendition: 'Default', px: body });
  return place(art, px, Math.floor((px - body) / 2));
}

function web({ px, rendition, shape }) {
  if (shape === 'any') return place(render({ platform: 'iOS', rendition, px }), px, 0);
  const zoomed = Math.round(px * BLEED_ZOOM);
  const art = render({ platform: 'iOS', rendition, px: zoomed });
  return place(art, px, -Math.floor((zoomed - px) / 2));
}

const sizes = [...new Set(ICNS_SLOTS.map(([, px]) => px))];
const mac = new Map(sizes.map((px) => [px, macos(px)]));
writeFileSync(join(ROOT, 'assets/AppIcon-1024.png'), mac.get(1024));
writeFileSync(
  join(ROOT, 'assets/AppIcon.icns'),
  encodeIcns(ICNS_SLOTS.map(([type, px]) => [type, mac.get(px)])),
);
for (const icon of WEB_ICONS) writeFileSync(join(ROOT, icon.path), web(icon));
console.log(`wrote assets/AppIcon-1024.png, assets/AppIcon.icns and ${WEB_ICONS.length} web icons`);
