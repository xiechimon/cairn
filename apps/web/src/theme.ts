import { safeLocalStorage } from './safe-storage.js';

export const THEME_STORAGE_KEY = 'cairn-theme';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export type Theme = 'light' | 'dark';

const LIGHT_SCHEME_QUERY = '(prefers-color-scheme: light)';

export function parseThemePreference(stored: string | null): ThemePreference {
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): Theme {
  if (preference === 'system') return systemPrefersLight ? 'light' : 'dark';
  return preference;
}

export function readStoredTheme(storage: Storage | null): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(THEME_STORAGE_KEY) ?? null);
  } catch {
    return 'system';
  }
}

function systemPrefersLight(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(LIGHT_SCHEME_QUERY).matches === true;
}

export function resolveStoredTheme(storage: Storage | null = safeLocalStorage()): Theme {
  return resolveTheme(readStoredTheme(storage), systemPrefersLight());
}

export function paintTheme(preference: ThemePreference): void {
  const theme = resolveTheme(preference, systemPrefersLight());
  const root = document.documentElement;
  const changed =
    root.dataset.theme !== theme || root.classList.contains('light') !== (theme === 'light');
  if (changed) {
    root.classList.add('theme-suppress');
    void root.offsetHeight;
    root.classList.toggle('light', theme === 'light');
    root.dataset.theme = theme;
  }
  const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', canvas);
  });
  if (!changed) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('theme-suppress');
    });
  });
}

export function applyTheme(
  preference: ThemePreference,
  storage: Storage | null = safeLocalStorage(),
): void {
  paintTheme(preference);
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {}
}

export function followSystemTheme(storage: Storage | null = safeLocalStorage()): () => void {
  const query = window.matchMedia?.(LIGHT_SCHEME_QUERY);
  if (query === undefined) return () => {};
  const onChange = () => {
    const preference = readStoredTheme(storage);
    if (preference === 'system') paintTheme(preference);
  };
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
