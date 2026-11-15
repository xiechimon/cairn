import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const SRC = new URL('../src/', import.meta.url).pathname;
const OWNERS = ['components/ui/', 'components/menu-keys.tsx', 'design/'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

test('menus are built from the keyed menu parts, so every action row can show its letter', () => {
  const offenders = walk(SRC)
    .map((path) => path.slice(SRC.length))
    .filter((path) => !OWNERS.some((owner) => path.startsWith(owner)))
    .flatMap((path) =>
      [
        ...readFileSync(join(SRC, path), 'utf8').matchAll(
          /<DropdownMenu(Content|SubContent|Item|SubTrigger|RadioItem|CheckboxItem)\b/g,
        ),
      ].map((m) => `${path}: ${m[0]}`),
    );
  expect(offenders).toEqual([]);
});
