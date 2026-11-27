import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type DesktopLocale = 'zh' | 'en';

const LOCALE_FILE_NAME = 'locale';

export function desktopLocale(lang: unknown): DesktopLocale {
  return typeof lang === 'string' && lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function readPersistedDesktopLocale(userData: string): DesktopLocale | null {
  const path = join(userData, LOCALE_FILE_NAME);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8').trim().toLowerCase();
    if (raw === 'zh' || raw === 'en') return raw;
  } catch {
    return null;
  }
  return null;
}

export function writePersistedDesktopLocale(userData: string, locale: DesktopLocale): void {
  const path = join(userData, LOCALE_FILE_NAME);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${locale}\n`, 'utf8');
}

export interface LocaleWindowCandidate {
  destroyed: boolean;
  loading: boolean;
  url: string;
  readLang: () => Promise<unknown>;
}

export async function resolveWindowLocale(
  windows: ReadonlyArray<LocaleWindowCandidate>,
  fallbackLang: unknown,
  timeoutMs = 250,
): Promise<DesktopLocale> {
  for (const candidate of windows) {
    if (candidate.destroyed || candidate.loading || !/^https?:\/\//i.test(candidate.url)) {
      continue;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lang = await Promise.race([
      candidate.readLang().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
        timer.unref();
      }),
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
    if (typeof lang === 'string' && lang !== '') return desktopLocale(lang);
  }
  return desktopLocale(fallbackLang);
}
