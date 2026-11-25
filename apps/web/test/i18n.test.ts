import { describe, expect, it } from 'vitest';
import { EN } from '../src/i18n/en.js';
import {
  LOCALE_STORAGE_KEYS,
  htmlLangFor,
  persistLocale,
  readStoredLocale,
  subscribeLocaleStorage,
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
  it('follows the browser language when nothing is stored', () => {
    expect(readStoredLocale(fakeStorage(), 'zh-CN')).toBe('zh');
    expect(readStoredLocale(fakeStorage(), 'zh-TW')).toBe('zh');
    expect(readStoredLocale(fakeStorage(), 'en-US')).toBe('en');
    expect(readStoredLocale(fakeStorage(), 'fr-FR')).toBe('en');
    expect(readStoredLocale(fakeStorage(), undefined)).toBe('en');
    expect(readStoredLocale(null, 'zh-CN')).toBe('zh');
  });

  it('prefers the stored choice over the browser language', () => {
    expect(readStoredLocale(fakeStorage({ 'cairn-locale': 'zh' }), 'en-US')).toBe('zh');
    expect(readStoredLocale(fakeStorage({ 'cairn-locale': 'en' }), 'zh-CN')).toBe('en');
  });

  it('reads the observed dual keys (r2 §1.5, cairn same-shape replacement)', () => {
    expect(LOCALE_STORAGE_KEYS).toEqual(['cairn.locale', 'cairn-locale']);
    expect(
      readStoredLocale(fakeStorage({ 'cairn.locale': 'en', 'cairn-locale': 'en' }), 'zh-CN'),
    ).toBe('en');
    expect(readStoredLocale(fakeStorage({ 'cairn-locale': 'en' }), 'zh-CN')).toBe('en');
  });

  it('ignores unknown stored values and falls back to the browser language', () => {
    const storage = fakeStorage({ 'cairn.locale': 'zh-TW', 'cairn-locale': 'zh-TW' });
    expect(readStoredLocale(storage, 'zh-CN')).toBe('zh');
    expect(readStoredLocale(storage, 'en-US')).toBe('en');
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

describe('translate plural form', () => {
  const PLURAL = { '运行了 {n} 条命令': 'Ran {n#1 command|# commands}' };

  it('picks the singular for 1 and the plural otherwise, with # standing for the value', () => {
    expect(translate('en', PLURAL, '运行了 {n} 条命令', { n: 1 })).toBe('Ran 1 command');
    expect(translate('en', PLURAL, '运行了 {n} 条命令', { n: 3 })).toBe('Ran 3 commands');
  });

  it('leaves zh renders on the plain placeholder', () => {
    expect(translate('zh', PLURAL, '运行了 {n} 条命令', { n: 3 })).toBe('运行了 3 条命令');
  });
});

describe('English count rendering', () => {
  it.each([0, 1, 2])('renders real dictionary counts for %s', (n) => {
    expect(translate('en', EN, '{n} 次运行', { n })).toBe(`${n} ${n === 1 ? 'run' : 'runs'}`);
  });

  it.each([-1, 1, 0, 2, 1.5, '1', 'many', Number.NaN, Number.POSITIVE_INFINITY])(
    'selects cardinal forms without coercing %s',
    (n) => {
      const dict = { count: '{n## member|# members}' };
      const singular = typeof n === 'number' && Math.abs(n) === 1;
      expect(translate('en', dict, 'count', { n })).toBe(`${n} ${singular ? 'member' : 'members'}`);
    },
  );

  it('preserves missing variables, fallback, Chinese and independent counts', () => {
    const dict = { count: '{a## member|# members}, {b## task|# tasks}' };
    expect(translate('en', dict, 'count', { a: 1, b: 2 })).toBe('1 member, 2 tasks');
    expect(translate('en', dict, 'count', { a: 2, b: 1 })).toBe('2 members, 1 task');
    expect(translate('en', dict, 'count', { a: 1 })).toBe('1 member, {b## task|# tasks}');
    expect(translate('en', dict, 'count')).toBe(dict.count);
    expect(translate('en', dict, '{n} missing', { n: 'one' })).toBe('one missing');
    expect(translate('zh', EN, '{n} 次运行', { n: 1 })).toBe('1 次运行');
  });
});

describe('subscribeLocaleStorage', () => {
  it('syncs locale across windows on storage events and ignores unrelated keys', () => {
    const listeners = new Set<(event: { key: string | null; newValue: string | null }) => void>();
    const target = {
      addEventListener: (_type: 'storage', fn: (event: { key: string | null; newValue: string | null }) => void) => {
        listeners.add(fn);
      },
      removeEventListener: (_type: 'storage', fn: (event: { key: string | null; newValue: string | null }) => void) => {
        listeners.delete(fn);
      },
    };
    const storage = fakeStorage({ 'cairn.locale': 'zh' });
    const seen: string[] = [];
    const unsubscribe = subscribeLocaleStorage((next) => seen.push(next), target, storage, 'en-US');

    for (const fn of listeners) fn({ key: 'cairn.theme', newValue: 'dark' });
    expect(seen).toEqual([]);

    for (const fn of listeners) fn({ key: 'cairn.locale', newValue: 'en' });
    for (const fn of listeners) fn({ key: 'cairn-locale', newValue: 'zh' });
    for (const fn of listeners) fn({ key: null, newValue: null });
    expect(seen).toEqual(['en', 'zh', 'zh']);

    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});

describe('EN dictionary hygiene', () => {
  const CHINESE_PUNCTUATION = /[。，：「」！？；、（）【】《》]/;

  it('contains no stray Chinese punctuation in English values', () => {
    const offenders = Object.entries(EN)
      .filter(([, value]) => CHINESE_PUNCTUATION.test(value))
      .map(([key, value]) => `${key} => ${value}`);
    expect(offenders).toEqual([]);
    expect(CHINESE_PUNCTUATION.test('Model unavailable。')).toBe(true);
  });

  it('contains no obsolete routing or pinned Runner wording in English guidance', () => {
    const obsolete = Object.entries(EN)
      .filter(
        ([key, value]) =>
          key.includes('或在这里创建规则') ||
          key.includes('工作路由') ||
          (key !== '模型路由' && key.includes('模型路由')) ||
          /\bwork routing\b/i.test(value) ||
          /\bpinned Runner\b/i.test(value),
      )
      .map(([key, value]) => `${key} => ${value}`);
    expect(obsolete).toEqual([]);
  });
});
