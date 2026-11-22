import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type DesktopLocale = 'zh' | 'en';

export function desktopLocale(lang: unknown): DesktopLocale {
  return typeof lang === 'string' && lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function openDesktopLocalePreference(
  userData: string,
  systemLocale: string,
  onError: (error: unknown) => void,
) {
  const path = join(userData, 'desktop-locale');
  let stored: DesktopLocale | undefined;
  try {
    const saved = readFileSync(path, 'utf8').trim();
    if (saved === 'en' || saved === 'zh') stored = saved;
  } catch {}
  let locale = stored ?? desktopLocale(systemLocale);
  return {
    locale: () => locale,
    set: (value: unknown): boolean => {
      if (value !== 'en' && value !== 'zh') return false;
      const changed = value !== locale;
      locale = value;
      if (stored !== value) {
        try {
          const temporary = `${path}.tmp`;
          writeFileSync(temporary, `${value}\n`, { mode: 0o600 });
          renameSync(temporary, path);
          stored = value;
        } catch (error) {
          onError(error);
        }
      }
      return changed;
    },
  };
}
