export type Locale = 'zh' | 'en';

export const LOCALE_STORAGE_KEYS = ['cairn.locale', 'cairn-locale'] as const;

const KNOWN: readonly string[] = ['zh', 'en'];

export function parseLocaleValue(value: string | null | undefined): Locale | null {
  return value != null && KNOWN.includes(value) ? (value as Locale) : null;
}

export function isLocaleStorageKey(key: string | null): boolean {
  return key !== null && (LOCALE_STORAGE_KEYS as readonly string[]).includes(key);
}

export interface StorageEventLike {
  key: string | null;
  newValue: string | null;
}

export interface StorageEventTargetLike {
  addEventListener: (type: 'storage', listener: (event: StorageEventLike) => void) => void;
  removeEventListener: (type: 'storage', listener: (event: StorageEventLike) => void) => void;
}

export function readStoredLocale(
  storage: Pick<Storage, 'getItem'> | null,
  browserLanguage: string | undefined = globalThis.navigator?.language,
): Locale {
  try {
    for (const key of LOCALE_STORAGE_KEYS) {
      const parsed = parseLocaleValue(storage?.getItem(key));
      if (parsed !== null) return parsed;
    }
  } catch {}
  return browserLanguage?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function persistLocale(locale: Locale, storage: Pick<Storage, 'setItem'> | null): void {
  try {
    for (const key of LOCALE_STORAGE_KEYS) storage?.setItem(key, locale);
  } catch {}
}

export function subscribeLocaleStorage(
  onLocale: (locale: Locale) => void,
  target: StorageEventTargetLike | null,
  storage: Pick<Storage, 'getItem'> | null,
  browserLanguage?: string,
): () => void {
  if (target === null) return () => {};
  const listener = (event: StorageEventLike) => {
    if (event.key !== null && !isLocaleStorageKey(event.key)) return;
    const next =
      event.key === null
        ? readStoredLocale(storage, browserLanguage)
        : (parseLocaleValue(event.newValue) ?? readStoredLocale(storage, browserLanguage));
    onLocale(next);
  };
  target.addEventListener('storage', listener);
  return () => target.removeEventListener('storage', listener);
}

export const LOCALES: readonly Locale[] = ['zh', 'en'];

export const LOCALE_NAMES: Record<Locale, string> = { zh: '简体中文', en: 'English' };

export function htmlLangFor(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

export function applyLocaleLang(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = htmlLangFor(locale);
}

let mountedLocale: Locale | null = null;

export function setActiveLocale(locale: Locale): void {
  mountedLocale = locale;
}

export function activeLocale(storage: Pick<Storage, 'getItem'> | null = null): Locale {
  if (mountedLocale !== null) return mountedLocale;
  return readStoredLocale(storage);
}
