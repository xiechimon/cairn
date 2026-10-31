import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const ICON_DIR = new URL('../src/icons/', import.meta.url);
const HEAVY_GLYPHS = new Set(['PlusSmall.tsx']);

describe('icon stroke', () => {
  const files = readdirSync(ICON_DIR).filter((f) => f.endsWith('.tsx'));
  test.each(files)('%s draws at stroke 1.75', (file) => {
    const strokes = [...readFileSync(new URL(file, ICON_DIR), 'utf8').matchAll(/strokeWidth="([\d.]+)"/g)].map(
      (m) => m[1],
    );
    const expected = HEAVY_GLYPHS.has(file) ? '3' : '1.75';
    for (const stroke of strokes) expect(stroke).toBe(expected);
  });
});
