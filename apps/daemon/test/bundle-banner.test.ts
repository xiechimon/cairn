import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(directory, entry.name)]
        : [],
  );
}

test('no daemon source redeclares what the bundle banner already declares', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const clashing = sources(root).filter((file) =>
    /import\s*\{[^}]*\bcreateRequire\b(?!\s+as\b)[^}]*\}\s*from\s*['"](node:)?module['"]/.test(
      readFileSync(file, 'utf8'),
    ),
  );
  expect(clashing).toEqual([]);
});
