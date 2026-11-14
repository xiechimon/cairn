import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ICON, brandFiles, ICNS_SLOTS, WEB_ICONS } from '../../../scripts/brand/logo.mjs';
import { decodeIcns, decodePng } from '../../../scripts/brand/raster.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const GENERATED = brandFiles();

describe('brand assets match scripts/brand/generate-logo.mjs', () => {
  it.each(GENERATED)(
    '%s is the generated text',
    (path, content) => {
      expect(readFileSync(resolve(ROOT, path), 'utf8')).toBe(content);
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

  it.each(WEB_ICONS)('$path is the app icon rendered by Icon Composer ($rendition, $shape)', ({ path, px, shape }) => {
    const { width, height, pixels } = decodePng(readFileSync(resolve(ROOT, path)));
    expect([width, height]).toEqual([px, px]);
    const alphaAt = (x: number, y: number) => pixels[(y * width + x) * 4 + 3];
    const corners = [alphaAt(0, 0), alphaAt(px - 1, 0), alphaAt(0, px - 1), alphaAt(px - 1, px - 1)];
    expect(corners).toEqual(shape === 'bleed' ? [255, 255, 255, 255] : [0, 0, 0, 0]);
    expect(alphaAt(px >> 1, px >> 1)).toBe(255);
    const colours = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3] === 255)
        colours.add(((pixels[i] ?? 0) << 16) | ((pixels[i + 1] ?? 0) << 8) | (pixels[i + 2] ?? 0));
    expect(colours.size).toBeGreaterThan(px * 2);
  });

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
