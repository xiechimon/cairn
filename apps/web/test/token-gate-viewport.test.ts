import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('the full-viewport pairing gate sizes from its fixed inset edges', () => {
  const source = readFileSync(new URL('../src/overlay/token-gate.tsx', import.meta.url), 'utf8');
  expect(source).toContain('width="auto"');
  expect(source).not.toContain('width="100vw"');
});
