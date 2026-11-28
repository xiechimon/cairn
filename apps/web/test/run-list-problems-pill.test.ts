import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('the problems filter changes its border and text when pressed', () => {
  const source = readFileSync(new URL('../src/runs/run-list.tsx', import.meta.url), 'utf8');
  const label = source.indexOf("{t('出问题的')}");
  const button = source.slice(source.lastIndexOf('<Button', label), label);
  expect(button).toContain('text-content-secondary');
  expect(button).toContain('aria-pressed:border-foreground');
  expect(button).toContain('aria-pressed:text-foreground');
});
