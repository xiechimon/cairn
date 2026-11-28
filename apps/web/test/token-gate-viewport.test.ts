import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('full-viewport overlays size from their fixed inset edges', () => {
  const tokenGate = readFileSync(new URL('../src/overlay/token-gate.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/settings/settings-page.tsx', import.meta.url), 'utf8');
  expect(tokenGate).toContain('width="auto"');
  expect(tokenGate).not.toContain('width="100vw"');
  expect(settings).toContain("width={tabs ? 'auto' : 'var(--settings-w)'}");
  expect(settings).not.toContain("'100vw'");
});
