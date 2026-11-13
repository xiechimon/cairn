import { useCallback, useSyncExternalStore } from 'react';

export const NARROW_QUERY = '(max-width: 640px)';
export const PANEL_DOCKED_QUERY = '(min-width: 1101px)';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

export function useNarrow(): boolean {
  return useMediaQuery(NARROW_QUERY);
}

export function usePanelDocked(): boolean {
  return useMediaQuery(PANEL_DOCKED_QUERY);
}
