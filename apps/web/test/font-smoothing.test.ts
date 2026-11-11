import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname;
const SCANNED = ['src', '.design-sync', 'index.html', 'design.html'];

function walk(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => walk(join(path, name)));
}

test('V25: no source forces a font smoothing mode', () => {
  const offenders = SCANNED.flatMap((entry) => walk(join(ROOT, entry)))
    .filter((path) => /\.(css|tsx?|html)$/.test(path))
    .filter((path) => /font-smoothing|\b(?:subpixel-)?antialiased\b/.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(ROOT.length));
  expect(offenders).toEqual([]);
});
