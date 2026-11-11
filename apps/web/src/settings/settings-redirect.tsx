import { Navigate, useLocation } from 'react-router';
import { type SettingsSectionId, settingsHref } from './settings-href.js';
import { SETTINGS_REDIRECT_STATE } from './use-settings-overlay.js';

const LEGACY_ACCOUNT_PARAMS = ['tab', 'vendor'];

function withoutParams(search: string, names: readonly string[]): string {
  const params = new URLSearchParams(search);
  for (const name of names) params.delete(name);
  const rest = params.toString();
  return rest === '' ? '' : `?${rest}`;
}

export function legacyAccountsSearch(search: string): string {
  return withoutParams(search, [...LEGACY_ACCOUNT_PARAMS, 'scope']);
}

export function SettingsRedirect({ section }: { section: SettingsSectionId }) {
  const { search, hash } = useLocation();
  return (
    <Navigate
      to={{ pathname: settingsHref(section), search, hash }}
      state={SETTINGS_REDIRECT_STATE}
      replace
    />
  );
}

export function opensLegacyAccounts(params: URLSearchParams): boolean {
  if (params.get('tab') === 'routing') return false;
  return params.has('vendor') || params.get('tab') === 'accounts';
}

export function LegacyModelRoutingRedirect() {
  const { search, hash } = useLocation();
  const routing = new URLSearchParams(search).get('tab') === 'routing';
  return (
    <Navigate
      to={{
        pathname: settingsHref(routing ? 'routing' : 'providers'),
        search: routing
          ? withoutParams(search, LEGACY_ACCOUNT_PARAMS)
          : legacyAccountsSearch(search),
        hash,
      }}
      state={SETTINGS_REDIRECT_STATE}
      replace
    />
  );
}
