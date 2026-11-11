import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SRC = new URL('../src/', import.meta.url).pathname;
const ICON_DIR = new URL('../src/icons/', import.meta.url);
const HEAVY_GLYPHS = new Set(['PlusSmall.tsx']);
const ICON_SIZES = new Set(['4', '5', '5.5']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

const sources = walk(SRC).map((path) => ({ path: path.slice(SRC.length), text: readFileSync(path, 'utf8') }));

describe('icon stroke', () => {
  const files = readdirSync(ICON_DIR).filter((f) => f.endsWith('.tsx'));
  test.each(files)('%s draws at stroke 1.75', (file) => {
    const strokes = [...readFileSync(new URL(file, ICON_DIR), 'utf8').matchAll(/strokeWidth="([\d.]+)"/g)].map(
      (m) => m[1],
    );
    const expected = HEAVY_GLYPHS.has(file) ? '3' : '1.75';
    for (const stroke of strokes) expect(stroke).toBe(expected);
  });

  test('V14: no component passes a numeric strokeWidth other than 1.75', () => {
    const offenders = sources.flatMap(({ path, text }) =>
      [...text.matchAll(/strokeWidth=\{(?!1\.75\}|STROKE\})[^}]*\}/g)].map((m) => `${path}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  test('V14: one global rule pins every lucide svg to 1.75, whatever the component passes', () => {
    const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
    expect(css).toMatch(/svg\.lucide\s*\{[^}]*stroke-width:\s*1\.75\s*;/);
  });

  test('V14: lucide icons are sized 16, 20 or 22 px', () => {
    const offenders: string[] = [];
    for (const { path, text } of sources) {
      const names = new Set<string>();
      for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
        for (const part of (m[1] ?? '').split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop();
          if (name !== undefined && name !== '' && !name.startsWith('type ')) names.add(name);
        }
      }
      for (const m of text.matchAll(/<([A-Z]\w*)\b([^>]*?)\/?>/gs)) {
        if (!names.has(m[1] ?? '')) continue;
        const cls = (m[2] ?? '').match(/className=(\{[^}]*\}|"[^"]*"|`[^`]*`)/)?.[1] ?? '';
        const sizes = [...cls.matchAll(/\b(?:size|h|w)-(\d+(?:\.\d+)?)\b/g)].map((x) => x[1] ?? '');
        if (sizes.some((s) => !ICON_SIZES.has(s))) offenders.push(`${path}: ${m[1]} ${cls}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
