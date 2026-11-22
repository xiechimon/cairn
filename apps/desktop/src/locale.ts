export type DesktopLocale = 'zh' | 'en';

export function desktopLocale(lang: unknown): DesktopLocale {
  return typeof lang === 'string' && lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
