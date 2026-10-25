import { safeLocalStorage } from './safe-storage.js';

export const DENSITY_STORAGE_KEY = 'cairn-density';
export const DENSITY_EVENT = 'cairn-density';

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
  root.dataset.density = density;
  root.dataset.densityTick = String((Number(root.dataset.densityTick) || 0) + 1);
  try {
    storage?.setItem(DENSITY_STORAGE_KEY, density);
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DENSITY_EVENT, { detail: density }));
  }
}
