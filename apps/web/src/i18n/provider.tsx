// i18n provider (issue #74): the one React seam of the mechanism — locale
// state + t() bound to the en dict, switchable at runtime from the account
// 语言 row. zh-CN is authoritative and the default; a switch persists to
// both observed storage keys (r2 §1.5) and flips <html lang> (r1 §1.1).
// No framework: issue #74 scopes the workspace layer to 仅中英 and rules
// the multilingual framework out, overriding the react-i18next pin in
// 01 §4.1 (that pin serves the four-language landing, a separate surface).
// useState + context is the whole machinery here.

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { safeLocalStorage } from '../safe-storage.js';
import { EN } from './en.js';
import { applyLocaleLang, type Locale, persistLocale, readStoredLocale } from './locale.js';
import { type TFunc, type TVars, translate } from './translate.js';

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunc;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale ?? readStoredLocale(safeLocalStorage()),
  );
  const setLocale = useCallback((next: Locale) => {
    persistLocale(next, safeLocalStorage());
    applyLocaleLang(next);
    setLocaleState(next);
  }, []);
  const t = useMemo<TFunc>(
    () => (source: string, vars?: TVars) => translate(locale, EN, source, vars),
    [locale],
  );
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value == null) throw new Error('useI18n() must be used inside <I18nProvider>');
  return value;
}
