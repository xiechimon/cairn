export const RELAUNCH_WINDOW_FILE_NAME = 'relaunch-window.json';

export interface RelaunchWindow {
  visible: boolean;
  minimized: boolean;
  maximized: boolean;
  fullScreen: boolean;
  path: string;
}

export interface WindowLike {
  isVisible(): boolean;
  isMinimized(): boolean;
  isMaximized(): boolean;
  isFullScreen(): boolean;
  url: string;
}

function samePath(origin: string, url: string): string {
  try {
    const parsed = new URL(url, origin);
    if (parsed.origin !== new URL(origin).origin) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

export function relaunchWindowOf(window: WindowLike, origin: string): RelaunchWindow {
  return {
    visible: window.isVisible(),
    minimized: window.isMinimized(),
    maximized: window.isMaximized(),
    fullScreen: window.isFullScreen(),
    path: samePath(origin, window.url),
  };
}

export function relaunchWindowAtRoot(window: WindowLike, origin: string): RelaunchWindow {
  return { ...relaunchWindowOf(window, origin), path: '/' };
}

export function parseRelaunchWindow(raw: string | null): RelaunchWindow | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const saved = value as Partial<Record<keyof RelaunchWindow, unknown>>;
  const flags = [saved.visible, saved.minimized, saved.maximized, saved.fullScreen];
  if (!flags.every((flag) => typeof flag === 'boolean') || typeof saved.path !== 'string') {
    return null;
  }
  return {
    visible: saved.visible as boolean,
    minimized: saved.minimized as boolean,
    maximized: saved.maximized as boolean,
    fullScreen: saved.fullScreen as boolean,
    path: saved.path,
  };
}

export function restoredUrl(origin: string, path: string): string {
  const base = new URL(origin).origin;
  return `${base}${path.startsWith('/') && !path.startsWith('//') ? samePath(base, `${base}${path}`) : '/'}`;
}
