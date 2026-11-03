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

let openReturnTo: string | null = null;

export function rememberSettingsReturn(path: string | null): void {
  openReturnTo = path;
}

export function settingsReturn(): string | null {
  return openReturnTo;
}
