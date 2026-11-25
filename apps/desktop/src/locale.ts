export type DesktopLocale = 'zh' | 'en';

export function desktopLocale(lang: unknown): DesktopLocale {
  return typeof lang === 'string' && lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
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
