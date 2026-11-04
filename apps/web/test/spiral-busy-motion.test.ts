import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SRC = new URL('../src/', import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe('busy spiral motion has one look', () => {
  const files = sources(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

  test('no spiral rotates: the busy state is the traced stroke everywhere', () => {
    const rotating = files.filter(
      ({ text }) => /spin_2\.4s|BUSY_SPIN_CLS|\.spin\{transform-origin/.test(text),
    );
    expect(rotating.map((f) => f.path.slice(SRC.length))).toEqual([]);
  });

  test('every spiral drawing that takes `busy` renders the spiral-trace stroke', () => {
    const spiralFiles = files.filter(
      ({ text }) => text.includes('SPIRAL_PATH') && /busy/.test(text) && text.includes('<path'),
    );
    expect(spiralFiles.length).toBeGreaterThan(0);
    for (const { path, text } of spiralFiles) {
      expect(text, path).toContain('spiral-trace');
    }
  });
});
