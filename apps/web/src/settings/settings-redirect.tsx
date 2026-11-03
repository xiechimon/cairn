import { Navigate, useLocation } from 'react-router';
import { type SettingsSectionId, settingsHref } from './settings-href.js';

export function SettingsRedirect({ section }: { section: SettingsSectionId }) {
  const { search, state } = useLocation();
  return <Navigate to={{ pathname: settingsHref(section), search }} state={state} replace />;
}
