// Locale mechanism (issue #74, 01-stack-v2 S6): the workspace is zh-CN
// authoritative with en as the only fallback language — zh-TW/ja are not
// built (no observed truth for them, 01 §4.1 i18n row). Persistence uses
// the r2 §1.5 observed dual-key contract: the official app writes both
// keys (原键 `tds.locale` + `tds-locale`) with the bare code (`zh`
// observed; `en` is [推断] — the dropdown option set was never captured,
// r2 §11 Q19). Keys are brand slots (brand.ts localStoragePrefix);
// replacement 已执行（D3 触发，#109）：`cairn.locale` + `cairn-locale`
// 同形替换（素材替换计划 §2）。

export type Locale = 'zh' | 'en';

/** Both observed spellings, read order = write order (r2 §1.5). */
export const LOCALE_STORAGE_KEYS = ['cairn.locale', 'cairn-locale'] as const;

/** zh-CN is authoritative (01 S6) — everything unset/unknown lands here. */
export const DEFAULT_LOCALE: Locale = 'zh';

const KNOWN: readonly string[] = ['zh', 'en'];

export function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en';
}

export function readStoredLocale(storage: Pick<Storage, 'getItem'> | null): Locale {
  // #1091：storage 为 null（safeLocalStorage 的不可用面）或 getItem 自身抛，
  // 都并进下面 DEFAULT_LOCALE 的既有回落路径。
  try {
    for (const key of LOCALE_STORAGE_KEYS) {
      const value = storage?.getItem(key);
      if (value != null && KNOWN.includes(value)) return value as Locale;
    }
  } catch {
    // fall through to the default
  }
  return DEFAULT_LOCALE;
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
