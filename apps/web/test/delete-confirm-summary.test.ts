import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const source = readFileSync(
  new URL('../src/overlay/delete-confirm.tsx', import.meta.url),
  'utf8',
);

test('the delete confirm summary wraps, so a sentence that does not fit stays readable', () => {
  const summaryClass = source.match(/className="delete-confirm-summary[^"]*"/)?.[0] ?? '';
  expect(summaryClass).not.toBe('');
  expect(summaryClass).not.toContain('whitespace-nowrap');
  expect(summaryClass).not.toContain('overflow-hidden');
});
