import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/thread/thread-row.tsx', import.meta.url),
  'utf8',
);

it('screen-reader status words go through t(), not bare English literals', () => {
  expect(source).not.toMatch(/sr-only">\{TONE_LABEL\[tone\]\}/);
  expect(source).not.toMatch(/aria-label="Snoozed"/);
  expect(source).not.toMatch(/aria-label=\{`Select /);
});
