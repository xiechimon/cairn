import { Navigate, useLocation, useParams } from 'react-router';
import { settingsHref } from '../settings/settings-href.js';

export function MachineDetailRedirect() {
  const { search } = useLocation();
  const machineId = useParams<{ id: string }>().id ?? '';
  const params = new URLSearchParams(search);
  params.set('machine', machineId);
  return (
    <Navigate to={{ pathname: settingsHref('machines'), search: params.toString() }} replace />
  );
}
