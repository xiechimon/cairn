import { describe, expect, test } from 'vitest';
import { compareVersions } from '../src/antigravity-local.js';
import { devinKeyFromToml } from '../src/devin-local.js';

describe('devinKeyFromToml', () => {
  test('pulls the double-quoted key', () => {
    const toml = [
      'windsurf_api_key = "wsk-real-key"',
      'api_server_url = "https://server.codeium.com"',
    ].join('\n');
    expect(devinKeyFromToml(toml)).toBe('wsk-real-key');
  });

  test('finds the key after other entries', () => {
    const toml =
      'api_server_url = "https://x"\nwindsurf_api_key = "wsk-late"\ndevin_api_url = "https://y"';
    expect(devinKeyFromToml(toml)).toBe('wsk-late');
  });

  test('accepts a single-quoted value', () => {
    expect(devinKeyFromToml("windsurf_api_key = 'wsk-single'")).toBe('wsk-single');
  });

  test('returns null when the key is absent or empty', () => {
    expect(devinKeyFromToml('api_server_url = "https://x"')).toBeNull();
    expect(devinKeyFromToml('windsurf_api_key = ""')).toBeNull();
    expect(devinKeyFromToml('')).toBeNull();
  });
});

describe('compareVersions', () => {
  test('sorts dotted versions numerically', () => {
    expect(
      ['3000.1.0', '3000.13.4', '3000.2.0'].sort((a, b) => compareVersions(b, a)),
    ).toEqual(['3000.13.4', '3000.2.0', '3000.1.0']);
  });
});
