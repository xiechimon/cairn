import { Navigate, useLocation } from 'react-router';
import { type SettingsSectionId, settingsHref } from './settings-href.js';

const LEGACY_ACCOUNT_PARAMS = ['tab', 'vendor'];

export function SettingsRedirect({ section }: { section: SettingsSectionId }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: settingsHref(section), search, hash }} replace />;
}

export function opensLegacyAccounts(params: URLSearchParams): boolean {
  if (params.get('tab') === 'routing') return false;
  return params.has('vendor') || params.get('tab') === 'accounts';
}

export function LegacyModelRoutingRedirect() {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  const routing = params.get('tab') === 'routing';
  for (const name of LEGACY_ACCOUNT_PARAMS) params.delete(name);
  const rest = params.toString();
  return (
    <Navigate
      to={{
        pathname: settingsHref(routing ? 'routing' : 'providers'),
        search: rest === '' ? '' : `?${rest}`,
        hash,
      }}
      replace
    />
  );
}
