import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, test } from 'vitest';
import type { ChiefContent } from '../src/fixtures/records.js';
import type { ChiefView } from '../src/overlay/gesture-machine.js';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const srcRoot = join(webRoot, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sources = walk(srcRoot)
  .filter((path) => /\.(tsx?|css)$/.test(path))
  .map((path) => ({ rel: relative(srcRoot, path), text: readFileSync(path, 'utf8') }));

function importersOf(module: string): string[] {
  const pattern = new RegExp(`from '[^']*/${module}(\\.js)?'`);
  return sources.filter((file) => pattern.test(file.text)).map((file) => file.rel);
}

describe('the Coordinator has one surface: the /app home', () => {
  test('no floating Coordinator window symbol, class or view survives in src', () => {
    const banned = /ChiefDrawer|chief-drawer|CHIEF_DRAWER|CHIEF_OPEN_STORAGE_KEY|chief\/toggle|chief\/open'/;
    expect(sources.filter((file) => banned.test(file.text)).map((file) => file.rel)).toEqual([]);
  });

  test("'drawer' is not a Coordinator view", () => {
    expectTypeOf<ChiefView>().toEqualTypeOf<'none' | 'settings'>();
    expectTypeOf<ChiefContent['view']>().toEqualTypeOf<'none' | 'settings'>();
  });

  test('the conversation renders only inside the home component', () => {
    expect(importersOf('chief-conversation')).toEqual(['board/home-c.tsx']);
    expect(importersOf('board/home-c')).toEqual(['routes/board-page.tsx']);
  });

  test('the home component mounts only on the /app route', () => {
    const app = sources.find((file) => file.rel === 'App.tsx')?.text ?? '';
    const mounts = [...app.matchAll(/\{ path: '([^']*)', element: <BoardPage \/> \}/g)].map(
      (match) => match[1],
    );
    expect(mounts).toEqual(['/app']);
    expect(app.match(/<BoardPage\b/g)).toHaveLength(1);
  });
});
