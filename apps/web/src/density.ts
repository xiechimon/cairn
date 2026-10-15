// Density preference (CDS PR-9): comfortable (default rem-scale) vs compact
// (`[data-density=compact]` → --rem-scale 0.9375 + tighter card/meta).
// Persisted under brand-slot key `pacman-density`, mirrored to
// documentElement.dataset.density like theme → data-theme.

import { safeLocalStorage } from './safe-storage.js';

export const DENSITY_STORAGE_KEY = 'pacman-density';

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

export function applyDensity(density: Density, storage: Storage | null = safeLocalStorage()): void {
  const root = document.documentElement;
  if (density === 'compact') {
    root.dataset.density = 'compact';
  } else {
    delete root.dataset.density;
  }
  try {
    storage?.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // Storage unavailable = session-only density (theme.ts same law).
  }
}
