export const SETTINGS_HREF = '/app/settings';

export const SETTINGS_SECTION_IDS = [
  'account',
  'appearance',
  'projects',
  'providers',
  'routing',
  'work-routing',
  'machines',
  'skills',
  'mcp',
  'secrets',
  'api-keys',
  'remote',
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export function settingsHref(section: SettingsSectionId): string {
  return `${SETTINGS_HREF}/${section}`;
}

export function settingsSectionOf(pathname: string): string | null {
  const match = /^\/app\/settings(?:\/([^/]+))?\/?$/.exec(pathname);
  if (match === null || match[1] === 'team') return null;
  return match[1] ?? '';
}
