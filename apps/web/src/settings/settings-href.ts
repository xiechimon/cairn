import { safeLocalStorage } from '../safe-storage.js';

export const SETTINGS_HREF = '/app/settings';
export const SETTINGS_SECTION_STORAGE_KEY = 'cairn.settings-section';

export const SETTINGS_SECTION_IDS = [
  'account',
  'routing',
  'machines',
  'skills',
  'mcp',
  'secrets',
  'vault',
  'api-keys',
  'remote',
  'im',
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

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return SETTINGS_SECTION_IDS.some((id) => id === value);
}

export function storedSettingsSection(): SettingsSectionId {
  let stored: string | null = null;
  try {
    stored = safeLocalStorage()?.getItem(SETTINGS_SECTION_STORAGE_KEY) ?? null;
  } catch (error) {
    console.debug('cairn: recoverable operation failed', error);
  }
  return isSettingsSectionId(stored) ? stored : 'account';
}
