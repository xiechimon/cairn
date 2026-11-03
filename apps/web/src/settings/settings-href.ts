export const SETTINGS_HREF = '/app/settings';

export const SETTINGS_SECTION_IDS = [
  'account',
  'appearance',
  'providers',
  'routing',
  'machines',
  'skills',
  'mcp',
  'secrets',
  'team',
  'api-keys',
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export function settingsHref(section: SettingsSectionId): string {
  return `${SETTINGS_HREF}/${section}`;
}
