import { safeLocalStorage } from './safe-storage.js';

export const THEME_STORAGE_KEY = 'cairn-theme';

export type Theme = 'light' | 'dark';

export function readStoredTheme(storage: Storage | null): Theme {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (stored === 'light' || stored === 'dark') return stored;
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function applyTheme(theme: Theme, storage: Storage | null = safeLocalStorage()): void {
  const root = document.documentElement;
  root.classList.add('theme-suppress');
  void root.offsetHeight;
  root.classList.toggle('light', theme === 'light');
  root.dataset.theme = theme;
  const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', canvas);
  });
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('theme-suppress');
    });
  });
}
