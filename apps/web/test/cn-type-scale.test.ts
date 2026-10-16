// Paper type-scale keys vs the `cn` class merger. The bare `cn` package reads
// any unknown `text-*` as a color, so `text-meta text-content-tertiary` used to
// lose `text-meta`, and every components/ui primitive merges className through
// cn. The keys are read from app.css so a new theme key without a matching cn
// entry fails here.
import { readFileSync } from 'node:fs';
import { cn } from 'cn';
import { describe, expect, test } from 'vitest';
import { buttonVariants } from '../src/components/ui/button.js';

const appCss = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
const typeKeys = [...appCss.matchAll(/^\s*--text-([a-z]+(?:-[a-z]+)*):/gm)].map((m) => m[1]);

describe('cn keeps Paper type-scale keys', () => {
  test('app.css declares the six Paper keys', () => {
    expect(typeKeys).toEqual(['page', 'heading', 'card-title', 'ui', 'meta', 'caption']);
  });

  test.each(typeKeys)('text-%s survives next to a text color', (key) => {
    expect(cn(`text-${key} text-content-tertiary`)).toBe(`text-${key} text-content-tertiary`);
    expect(cn(`text-${key}`, 'text-(--card-button)')).toBe(`text-${key} text-(--card-button)`);
  });

  test.each(typeKeys)('text-%s replaces a default size', (key) => {
    expect(cn('text-xs text-foreground', `text-${key}`)).toBe(`text-foreground text-${key}`);
  });

  test('two type keys dedupe to the later one', () => {
    expect(cn('text-meta', 'text-ui')).toBe('text-ui');
    expect(cn('text-heading text-foreground', 'text-page')).toBe('text-foreground text-page');
  });

  test('text-card stays a color beside text-card-title', () => {
    expect(cn('text-card-title text-card')).toBe('text-card-title text-card');
  });

  test('Button className text-meta wins over the size variant', () => {
    const merged = cn(
      buttonVariants({ variant: 'ghost', size: 'xs', className: 'text-meta text-content-tertiary' }),
    ).split(' ');
    expect(merged).toContain('text-meta');
    expect(merged).toContain('text-content-tertiary');
    expect(merged).not.toContain('text-xs');
    expect(merged).not.toContain('text-sm');
  });
});
