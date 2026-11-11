import { useRef } from 'react';
import { type Location, useLocation, useNavigate } from 'react-router';
import { settingsSectionOf } from './settings-href.js';

interface PageEntry {
  location: Location;
  historyIndex: number | null;
}

function currentHistoryIndex(): number | null {
  const index: unknown = window.history.state?.idx;
  return typeof index === 'number' ? index : null;
}

export function useSettingsOverlay() {
  const location = useLocation();
  const navigate = useNavigate();
  const section = settingsSectionOf(location.pathname);
  const lastPage = useRef<PageEntry | null>(null);
  if (section === null) {
    lastPage.current = {
      location,
      historyIndex: currentHistoryIndex(),
    };
  }
  const scenario = new URLSearchParams(location.search).get('scenario');
  const pageLocation: Partial<Location> = lastPage.current?.location ?? {
    pathname: '/app',
    search: scenario === null ? '' : `?scenario=${encodeURIComponent(scenario)}`,
    hash: '',
  };
  const close = () => {
    const page = lastPage.current;
    const now = currentHistoryIndex();
    if (page?.historyIndex != null && now != null && page.historyIndex < now) {
      navigate(page.historyIndex - now);
      return;
    }
    navigate(
      { pathname: pageLocation.pathname, search: pageLocation.search, hash: pageLocation.hash },
      { replace: true },
    );
  };
  return { section, pageLocation, close };
}
