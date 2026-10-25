export type Locale = 'zh' | 'en';

/** Both observed spellings, read order = write order (r2 §1.5). */
export const LOCALE_STORAGE_KEYS = ['cairn.locale', 'cairn-locale'] as const;

const KNOWN: readonly string[] = ['zh', 'en'];

export function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en';
}

export function readStoredLocale(
  storage: Pick<Storage, 'getItem'> | null,
  browserLanguage: string | undefined = globalThis.navigator?.language,
): Locale {
  try {
    for (const key of LOCALE_STORAGE_KEYS) {
      const value = storage?.getItem(key);
      if (value != null && KNOWN.includes(value)) return value as Locale;
    }
  } catch {
    // fall through to the default
  }
  return browserLanguage?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function persistLocale(locale: Locale, storage: Pick<Storage, 'setItem'> | null): void {
  // the official profile carries both keys with identical values (r2 §1.5)
  try {
    for (const key of LOCALE_STORAGE_KEYS) storage?.setItem(key, locale);
  } catch {
    // #1091 写不进 = 不持久，切换只在会话内生效（auth.ts writeToken 同律）
  }
}

/** Dropdown order for the account 语言 row. */
export const LOCALES: readonly Locale[] = ['zh', 'en'];

/** Endonyms for the account 语言 dropdown and row value ([设计] — the
 *  official option set was never observed, r2 §11 Q19; each language names
 *  itself in its own script under both locales, the common convention). */
export const LOCALE_NAMES: Record<Locale, string> = { zh: '简体中文', en: 'English' };

/** `<html lang>` per locale — index.html ships zh-CN (r1 §1.1 163 pages). */
export function htmlLangFor(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

export function applyLocaleLang(locale: Locale): void {
  document.documentElement.lang = htmlLangFor(locale);
}
