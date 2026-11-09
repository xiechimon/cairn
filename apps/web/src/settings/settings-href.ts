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

let lastOutside: string | null = null;

export function recordOutsideLocation(path: string): void {
  lastOutside = path;
}

export function lastOutsideLocation(): string | null {
  return lastOutside;
}
