import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'design' ? [] : sources(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

function openingTags(source: string, tag: string): string[] {
  return [...source.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))].map((m) => m[1] ?? '');
}

describe('the greeting and page titles use the serif title voice (DESIGN.md Typography)', () => {
  it('the Greeting component is serif at the greeting size', () => {
    const greeting = readFileSync(join(SRC, 'components/stream/greeting.tsx'), 'utf8');
    expect(greeting).toContain('font-serif');
    expect(greeting).toContain('text-greeting');
    expect(greeting).not.toContain('font-heading');
  });

  it('no page h1 is set in the heading face', () => {
    const offenders = sources(SRC).flatMap((file) =>
      openingTags(readFileSync(file, 'utf8'), 'h1')
        .filter((attrs) => attrs.includes('font-heading'))
        .map(() => relative(SRC, file)),
    );
    expect(offenders).toEqual([]);
  });

  it('the home greets with the serif Greeting', () => {
    const home = readFileSync(join(SRC, 'board/home-c.tsx'), 'utf8');
    expect(home).toContain('<Greeting as="h2">');
  });

  it('the page-size title menu trigger is serif', () => {
    const trigger = readFileSync(join(SRC, 'components/title-menu-trigger.tsx'), 'utf8');
    expect(trigger).toMatch(/page: '[^']*font-serif text-page/);
  });
});
