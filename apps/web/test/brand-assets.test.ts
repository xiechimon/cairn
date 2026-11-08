import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandFiles } from '../../../scripts/brand/logo.mjs';
import { type Bitmap, decodeIcns, decodePng } from '../../../scripts/brand/raster.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const GENERATED = brandFiles();

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
