import { Navigate, useLocation, useParams } from 'react-router';
import { settingsHref } from '../settings/settings-href.js';
import { SETTINGS_REDIRECT_STATE } from '../settings/use-settings-overlay.js';

export function MachineDetailRedirect() {
  const { search } = useLocation();
  const machineId = useParams<{ id: string }>().id ?? '';
  const params = new URLSearchParams(search);
  params.set('machine', machineId);
  return (
    <Navigate
      to={{ pathname: settingsHref('machines'), search: params.toString() }}
      state={SETTINGS_REDIRECT_STATE}
      replace
    />
  );
}
