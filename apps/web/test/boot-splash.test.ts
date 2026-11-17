import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { BRAND_GLYPH } from '../src/lib/brand-mark.js';

const WEB = new URL('../', import.meta.url).pathname;

describe('the boot splash draws the brand spiral while the app loads', () => {
  const js = readFileSync(join(WEB, 'public/boot-skeleton.js'), 'utf8');

  test('it traces the same path as the brand glyph', () => {
    expect(js).toContain(BRAND_GLYPH.large.d);
  });

  test('it shows already drawn under reduced motion', () => {
    expect(js).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  test('its caption exists in both locales', () => {
    expect(js).toContain('正在连接…');
    expect(js).toContain('Connecting…');
  });
});
