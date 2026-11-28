import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('a folded trace row keeps its title and lets the description shrink', () => {
  const source = readFileSync(new URL('../src/runs/run-page.tsx', import.meta.url), 'utf8');
  const folded = source.slice(source.indexOf('function Folded('), source.indexOf('function ToolRow('));
  expect(folded).toMatch(/<TraceTitle className="[^"]*\bshrink-0\b[^"]*">/);
  expect(folded).toMatch(/<TraceDescription className="[^"]*\bmin-w-0 shrink truncate\b[^"]*">/);
});
