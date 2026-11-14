#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_ICON, ICNS_SLOTS } from './logo.mjs';
import { decodePng, encodeIcns, encodePng } from './raster.mjs';

const ROOT = join(import.meta.dirname, '../..');
const ICTOOL =
  '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool';
const MACOS_BODY = 824 / 1024;
const scratch = mkdtempSync(join(tmpdir(), 'cairn-app-icon-'));

function render(px) {
  const body = Math.round(px * MACOS_BODY);
  const out = join(scratch, `${px}.png`);
  execFileSync(ICTOOL, [
    join(ROOT, APP_ICON),
    '--export-image',
    '--output-file',
    out,
    '--platform',
    'macOS',
    '--rendition',
    'Default',
    '--width',
    String(body),
    '--height',
    String(body),
    '--scale',
    '1',
  ]);
  const art = decodePng(readFileSync(out));
  const pixels = Buffer.alloc(px * px * 4);
  const inset = Math.floor((px - body) / 2);
  for (let y = 0; y < body; y += 1)
    art.pixels.copy(pixels, ((y + inset) * px + inset) * 4, y * body * 4, (y + 1) * body * 4);
  return encodePng({ width: px, height: px, pixels });
}

const sizes = [...new Set(ICNS_SLOTS.map(([, px]) => px))];
const pngs = new Map(sizes.map((px) => [px, render(px)]));
writeFileSync(join(ROOT, 'assets/AppIcon-1024.png'), pngs.get(1024));
writeFileSync(
  join(ROOT, 'assets/AppIcon.icns'),
  encodeIcns(ICNS_SLOTS.map(([type, px]) => [type, pngs.get(px)])),
);
console.log('wrote assets/AppIcon-1024.png and assets/AppIcon.icns');
