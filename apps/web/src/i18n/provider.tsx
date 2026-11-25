import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { safeLocalStorage } from '../safe-storage.js';
import { EN } from './en.js';
import {
  applyLocaleLang,
  type Locale,
  persistLocale,
  readStoredLocale,
  setActiveLocale,
  subscribeLocaleStorage,
} from './locale.js';
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
  setActiveLocale(locale);
  const setLocale = useCallback((next: Locale) => {
    persistLocale(next, safeLocalStorage());
    applyLocaleLang(next);
    setActiveLocale(next);
    setLocaleState(next);
  }, []);
  useEffect(() => {
    if (initialLocale !== undefined || typeof window === 'undefined') return;
    return subscribeLocaleStorage(
      (next) => {
        applyLocaleLang(next);
        setActiveLocale(next);
        setLocaleState(next);
      },
      window,
      safeLocalStorage(),
    );
  }, [initialLocale]);
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
