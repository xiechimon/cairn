// Density preference (CDS PR-9): comfortable (default rem-scale) vs compact
// (`[data-density=compact]` → --rem-scale 0.9375 + tighter card/meta).
// Persisted under brand-slot key `pacman-density`, mirrored to
// documentElement.dataset.density like theme → data-theme.
// applyDensity broadcasts DENSITY_EVENT so account + user-menu segment
// state stay in sync (Bugbot on #1366).

import { safeLocalStorage } from './safe-storage.js';

export const DENSITY_STORAGE_KEY = 'pacman-density';
/** Window event name; detail = Density. */
export const DENSITY_EVENT = 'pacman-density';

export type Density = 'comfortable' | 'compact';

export function readStoredDensity(storage: Storage | null): Density {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(DENSITY_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (stored === 'compact' || stored === 'comfortable') return stored;
  return 'comfortable';
}

export function readDomDensity(): Density {
  const raw = document.documentElement.dataset.density;
  if (raw === 'compact' || raw === 'comfortable') return raw;
  return 'comfortable';
}

export function applyDensity(density: Density, storage: Storage | null = safeLocalStorage()): void {
  const root = document.documentElement;
  // Always stamp data-density (comfortable | compact) so a no-op re-click of
  // the active segment still mutates the DOM via densityTick (account-controls
  // 假可供性 probe; theme.ts gets the same from .theme-suppress). Compact CSS
  // keys on [data-density='compact'] only.
  root.dataset.density = density;
  root.dataset.densityTick = String((Number(root.dataset.densityTick) || 0) + 1);
  try {
    storage?.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // Storage unavailable = session-only density (theme.ts same law).
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DENSITY_EVENT, { detail: density }));
  }
}
