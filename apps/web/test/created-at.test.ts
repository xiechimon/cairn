import { describe, expect, it } from 'vitest';
import { formatCreatedAt } from '../src/detail/fresh-block.js';
import { EN } from '../src/i18n/en.js';
import { translate, type TVars } from '../src/i18n/translate.js';

const TS = Date.parse('2026-09-21T13:21:00+08:00');

const zh = (source: string, vars?: TVars) => translate('zh', EN, source, vars);
const en = (source: string, vars?: TVars) => translate('en', EN, source, vars);

describe('formatCreatedAt', () => {
  it('zh renders the r7 23 capture line byte-identically', () => {
    expect(formatCreatedAt(TS, zh)).toBe('2026年9月21日 13:21 创建');
  });

  it('en renders the dict fallback shape', () => {
    expect(formatCreatedAt(TS, en)).toBe('Created Sep 21, 2026 13:21');
  });
});
