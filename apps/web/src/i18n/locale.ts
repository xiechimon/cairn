export type Locale = 'zh' | 'en';

export const LOCALE_STORAGE_KEYS = ['cairn.locale', 'cairn-locale'] as const;

const KNOWN: readonly string[] = ['zh', 'en'];

export function readStoredLocale(
  storage: Pick<Storage, 'getItem'> | null,
  browserLanguage: string | undefined = globalThis.navigator?.language,
): Locale {
  try {
    for (const key of LOCALE_STORAGE_KEYS) {
      const value = storage?.getItem(key);
      if (value != null && KNOWN.includes(value)) return value as Locale;
    }
  } catch {}
  return browserLanguage?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function persistLocale(locale: Locale, storage: Pick<Storage, 'setItem'> | null): void {
  try {
    for (const key of LOCALE_STORAGE_KEYS) storage?.setItem(key, locale);
  } catch {}
}

export const LOCALES: readonly Locale[] = ['zh', 'en'];

export const LOCALE_NAMES: Record<Locale, string> = { zh: '简体中文', en: 'English' };

export function htmlLangFor(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

export function applyLocaleLang(locale: Locale): void {
  document.documentElement.lang = htmlLangFor(locale);
}
