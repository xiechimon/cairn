import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ICON, brandFiles, ICNS_SLOTS, PLATE } from '../../../scripts/brand/logo.mjs';
import { type Bitmap, decodeIcns, decodePng } from '../../../scripts/brand/raster.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const GENERATED = brandFiles();

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

function largestChannelGap(a: Bitmap, b: Bitmap): number {
  expect([b.width, b.height]).toEqual([a.width, a.height]);
  let gap = 0;
  for (let i = 0; i < a.pixels.length; i += 1)
    gap = Math.max(gap, Math.abs((a.pixels[i] ?? 0) - (b.pixels[i] ?? 0)));
  return gap;
}

describe('brand assets match scripts/brand/generate-logo.mjs', () => {
  it.each(GENERATED.filter(([, content]) => typeof content === 'string'))(
    '%s is the generated text',
    (path, content) => {
      expect(readFileSync(resolve(ROOT, path), 'utf8')).toBe(content);
    },
  );

  it.each(GENERATED.filter(([path]) => path.endsWith('.png')))(
    '%s has the generated pixels',
    (path, content) => {
      const committed = decodePng(readFileSync(resolve(ROOT, path)));
      expect(largestChannelGap(decodePng(content as Buffer), committed)).toBeLessThanOrEqual(1);
    },
  );

  it.each(GENERATED.filter(([path]) => path.endsWith('.icns')))(
    '%s has the generated slots and pixels',
    (path, content) => {
      const generated = decodeIcns(content as Buffer);
      const committed = decodeIcns(readFileSync(resolve(ROOT, path)));
      expect(committed.map(([type]) => type)).toEqual(generated.map(([type]) => type));
      generated.forEach(([, png], i) => {
        const [, committedPng] = committed[i] ?? [];
        expect(committedPng).toBeDefined();
        expect(
          largestChannelGap(decodePng(png), decodePng(committedPng as Buffer)),
        ).toBeLessThanOrEqual(1);
      });
    },
  );

  it('the iOS app icon is one filled spiral layer with a gradient fill per appearance', () => {
    const files = new Map(GENERATED);
    const json = files.get(`${APP_ICON}/icon.json`);
    const layer = files.get(`${APP_ICON}/Assets/spiral.svg`);
    expect(typeof json).toBe('string');
    expect(layer).toMatch(/<path d="M[^"]+Z" fill="#[0-9a-f]{6}"\/>/);
    expect(layer).not.toMatch(/stroke/);
    const icon = JSON.parse(json as string);
    const layers = icon.groups.flatMap((g: { layers: { 'image-name': string }[] }) => g.layers);
    expect(layers.map((l: { 'image-name': string }) => l['image-name'])).toEqual(['spiral.svg']);
    const fills = layers[0]['fill-specializations'];
    expect(fills.map((f: { appearance?: string }) => f.appearance ?? 'light')).toEqual(['light', 'dark']);
    for (const fill of fills) expect(fill.value['linear-gradient']).toHaveLength(2);
    const committedAssets = readdirSync(resolve(ROOT, APP_ICON, 'Assets')).sort();
    expect(committedAssets).toEqual(['spiral.svg']);
  });

  it('the macOS icns holds every slot exported from the app icon', () => {
    const slots = decodeIcns(readFileSync(resolve(ROOT, 'assets/AppIcon.icns')));
    expect(slots.map(([type]) => type)).toEqual(ICNS_SLOTS.map(([type]) => type));
    slots.forEach(([, png], i) => {
      const { width, height } = decodePng(png);
      expect([width, height]).toEqual([ICNS_SLOTS[i]?.[1], ICNS_SLOTS[i]?.[1]]);
    });
    const { width } = decodePng(readFileSync(resolve(ROOT, 'assets/AppIcon-1024.png')));
    expect(width).toBe(1024);
  });

  it.each(GENERATED.filter(([path]) => path.endsWith('.svg')))(
    '%s is flat: no filter, gradient, shadow, mask or embedded image',
    (_path, content) => {
      expect(content).not.toMatch(/filter|gradient|shadow|<mask|<image|opacity/i);
    },
  );

  it.each(GENERATED.filter(([path]) => path.endsWith('.png')))(
    '%s holds only its plate, its ink and the blend between them',
    (path, content) => {
      const { fill, ink } = PLATE[path.includes('-light') ? 'light' : 'dark'];
      const plate = rgb(fill);
      const mark = rgb(ink);
      const { pixels } = decodePng(content as Buffer);
      let stray = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3] ?? 0;
        if (alpha === 0) continue;
        const t = alpha < 255 ? 0 : ((pixels[i] ?? 0) - plate[0]) / (mark[0] - plate[0]);
        const off = [0, 1, 2].some(
          (c) => Math.abs((pixels[i + c] ?? 0) - (plate[c] ?? 0) - t * ((mark[c] ?? 0) - (plate[c] ?? 0))) > 2,
        );
        if (off) stray += 1;
      }
      expect(stray).toBe(0);
    },
  );

  it('every icon the manifest and index.html link exists', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(ROOT, 'apps/web/public/manifest.webmanifest'), 'utf8'),
    );
    const html = readFileSync(resolve(ROOT, 'apps/web/index.html'), 'utf8');
    const linked = [
      ...manifest.icons.map((icon: { src: string }) => icon.src),
      ...[...html.matchAll(/rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
    ];
    expect(linked.length).toBeGreaterThan(4);
    for (const src of linked) expect(existsSync(resolve(ROOT, `apps/web/public${src}`))).toBe(true);
  });
});
