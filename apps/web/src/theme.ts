// Theme mechanism (r2 §1.5): dark is the :root default, light is opted in
// by putting .light on <html>. Persisted under the brand-slot key
// `pacman-theme` (observed original `tds-theme`, r2 §1.5; D3 同形替换
// #109; values: "light" | "dark"), mirrored to data-theme like the official app.
// The only visible control is the 外观 segmented row inside the user-menu
// popover (#122 wired it to applyTheme; the popover open/close trigger
// still waits on the overlay ticket); the fixture build sets the theme
// via storage injection.
// #129: a visit with no stored choice follows the system preference
// (matchMedia prefers-color-scheme); a stored value always wins, and the
// boot-time applyTheme persists the resolved choice.
// #1091: every storage touch here rides safe-storage.ts — a dead Storage
// surface (sandbox iframe / ITP / 隐私模式) degrades to the existing
// no-stored-value path instead of killing the boot.

import { safeLocalStorage } from './safe-storage.js';

export const THEME_STORAGE_KEY = 'pacman-theme'; // mirrored in e2e (theme-toggle / sidebar-visual specs)

export type Theme = 'light' | 'dark';

const THEME_CHROME: Record<Theme, string> = { light: '#f3eee5', dark: '#1f1b18' };

export function readStoredTheme(storage: Storage | null): Theme {
  // #1091：storage 为 null（safeLocalStorage 的不可用面）或 getItem 自身抛
  // （Storage 对象在但被禁读）都并进下面「无存储 = 跟系统」的既有回落路径。
  let stored: string | null = null;
  try {
    stored = storage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (stored === 'light' || stored === 'dark') return stored;
  // 无存储 = 跟系统；无 matchMedia 的环境（非浏览器测试）保持 dark 默认。
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function applyTheme(theme: Theme, storage: Storage | null = safeLocalStorage()): void {
  const root = document.documentElement;
  // Theme-switch suppression (base-ui-theme §1.2/F8, better-ui recipe): the
  // .light flip repaints every color/background/border/shadow token at once —
  // without it all those transitions fire together and the page smears.
  // .theme-suppress (motion.css) rides <html> across the flip: add it, force
  // a reflow so it applies before the flip paints, flip, drop it two frames
  // later. The class never survives the call (theme-toggle.spec.ts pins the
  // add and the removal).
  root.classList.add('theme-suppress');
  // A same-task style read forces the suppression above into effect before
  // the class flip below — without it both land in one recalc and the
  // transitions still fire.
  void root.offsetHeight;
  root.classList.toggle('light', theme === 'light');
  root.dataset.theme = theme;
  // index.html's media-scoped theme-color metas track the system scheme; the
  // stored choice has to win over it, so the content is rewritten here.
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', THEME_CHROME[theme]);
  });
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // #1091 写不进（Storage 不可用 / 旧 Safari 隐私模式 setItem 抛）= 主题
    // 只在会话内生效，静默丢（auth.ts writeToken 同律）。
  }
  // Two frames: the flip paints transition-free in the first, the second
  // lets same-task style reads settle before transitions return.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('theme-suppress');
    });
  });
}
