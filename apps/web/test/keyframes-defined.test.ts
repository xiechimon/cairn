import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname;
const TAILWIND_KEYFRAMES = new Set(['spin', 'ping', 'pulse', 'bounce']);

function walk(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => walk(join(path, name)));
}

test('every animation the source names has a keyframe', () => {
  const files = walk(join(ROOT, 'src')).filter((path) => /\.(css|tsx?)$/.test(path));
  const sources = files.map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  const defined = new Set(
    sources.flatMap(({ text }) => [...text.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])),
  );
  const used = sources.flatMap(({ path, text }) => [
    ...[...text.matchAll(/animate-\[([a-z0-9-]+)_/g)].map((m) => ({ path, name: m[1] })),
    ...[...text.matchAll(/(?:^|[;{\s])animation(?:-name)?:\s*([\w-]+)/gm)].map((m) => ({
      path,
      name: m[1],
    })),
  ]);
  const missing = used
    .filter(({ name }) => name !== undefined && name !== 'none' && !name.startsWith('var'))
    .filter(({ name }) => !defined.has(name) && !TAILWIND_KEYFRAMES.has(name ?? ''))
    .map(({ path, name }) => `${path.slice(ROOT.length)}: ${name}`);
  expect([...new Set(missing)]).toEqual([]);
});
