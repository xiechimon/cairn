import { describe, expect, it } from 'vitest';
import {
  parseThemePreference,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
} from '../src/theme.js';

function storageWith(value: string | null): Storage {
  return {
    getItem: (key: string) => (key === THEME_STORAGE_KEY ? value : null),
  } as Storage;
}

describe('theme preference', () => {
  it('keeps stored light and dark values working', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(readStoredTheme(storageWith('light'))).toBe('light');
    expect(readStoredTheme(storageWith('dark'))).toBe('dark');
  });

  it('treats a missing, unknown or unreadable value as following the system', () => {
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('sepia')).toBe('system');
    expect(readStoredTheme(storageWith('system'))).toBe('system');
    expect(readStoredTheme(null)).toBe('system');
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(readStoredTheme(throwing)).toBe('system');
  });

  it('resolves system from the colour scheme and pins explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
  });
});
