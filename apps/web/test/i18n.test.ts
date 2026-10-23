// i18n core seam (issue #74): workspace zh-CN authoritative + en fallback
// (01-stack-v2 §4.1 i18n row, S6). Locale persistence follows the r2 §1.5
// observed dual-key contract (原键 `tds.locale` + `tds-locale`，value `zh`；
// `en` is [推断] — the official dropdown set was never observed, r2 §11
// Q19). D3 替换相位（#109）：键前缀 `cairn.locale` + `cairn-locale`
// 同形替换（素材替换计划 §2 localStorage 键族）。
// zh renders must be identity — the capture-verbatim strings are the
// regression anchor, so t() must never rewrite the canonical source string.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEYS,
  htmlLangFor,
  persistLocale,
  readStoredLocale,
} from '../src/i18n/locale.js';
import { translate } from '../src/i18n/translate.js';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    dump: () => Object.fromEntries(map),
  };
}

const DICT: Record<string, string> = {
  工作台: 'Workbench',
  '{n} 分钟前': '{n} minutes ago',
};

describe('readStoredLocale', () => {
  it('defaults to zh (zh-CN is the authoritative locale)', () => {
    expect(DEFAULT_LOCALE).toBe('zh');
    expect(readStoredLocale(fakeStorage())).toBe('zh');
  });

  it('reads the observed dual keys (r2 §1.5, cairn 同形替换)', () => {
    expect(LOCALE_STORAGE_KEYS).toEqual(['cairn.locale', 'cairn-locale']);
    expect(readStoredLocale(fakeStorage({ 'cairn.locale': 'en', 'cairn-locale': 'en' }))).toBe(
      'en',
    );
    // either key alone is enough — the official app writes both, but a
    // partially-migrated profile must still resolve
    expect(readStoredLocale(fakeStorage({ 'cairn-locale': 'en' }))).toBe('en');
  });

  it('ignores unknown values (future locale codes fall back to zh)', () => {
    expect(
      readStoredLocale(fakeStorage({ 'cairn.locale': 'zh-TW', 'cairn-locale': 'zh-TW' })),
    ).toBe('zh');
  });
});

describe('persistLocale', () => {
  it('writes both observed keys with the bare code', () => {
    const storage = fakeStorage();
    persistLocale('en', storage);
    expect(storage.dump()).toEqual({ 'cairn.locale': 'en', 'cairn-locale': 'en' });
  });
});

describe('htmlLangFor', () => {
  it('maps locales to the html lang attribute (index.html ships zh-CN)', () => {
    expect(htmlLangFor('zh')).toBe('zh-CN');
    expect(htmlLangFor('en')).toBe('en');
  });
});

describe('translate', () => {
  it('zh is identity — the canonical source string renders untouched', () => {
    expect(translate('zh', DICT, '工作台')).toBe('工作台');
    // an entry missing from the dict still renders (zh never needs the dict)
    expect(translate('zh', DICT, '尚无描述')).toBe('尚无描述');
  });

  it('en looks the source string up in the dict', () => {
    expect(translate('en', DICT, '工作台')).toBe('Workbench');
  });

  it('en falls back to the zh source when the dict has no entry', () => {
    expect(translate('en', DICT, '尚无描述')).toBe('尚无描述');
  });

  it('interpolates {vars} into whichever template was selected', () => {
    expect(translate('zh', DICT, '{n} 分钟前', { n: 9 })).toBe('9 分钟前');
    expect(translate('en', DICT, '{n} 分钟前', { n: 9 })).toBe('9 minutes ago');
  });

  it('leaves unmatched placeholders intact and tolerates missing vars', () => {
    expect(translate('zh', DICT, '{n} 分钟前')).toBe('{n} 分钟前');
    expect(translate('en', DICT, '工作台', { n: 1 })).toBe('Workbench');
  });
});
