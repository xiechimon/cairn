import { describe, expect, test } from 'vitest';
import { devinBinaryCandidates, devinKeyFromToml } from '../src/devin-local.js';

const HOME = '/Users/tester';

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

describe('devinBinaryCandidates', () => {
  test('PATH entries come first, then the installer and packaged locations', () => {
    const candidates = devinBinaryCandidates({
      home: HOME,
      pathEnv: '/opt/thing/bin:/usr/bin',
      managedVersions: [],
    });
    expect(candidates).toEqual([
      '/opt/thing/bin/devin',
      '/usr/bin/devin',
      '/Users/tester/.local/bin/devin',
      '/opt/homebrew/bin/devin',
      '/usr/local/bin/devin',
    ]);
  });

  test('falls back to well-known paths when PATH is empty', () => {
    const candidates = devinBinaryCandidates({ home: HOME, pathEnv: '', managedVersions: [] });
    expect(candidates[0]).toBe(`${HOME}/.local/bin/devin`);
  });

  test('managed installs sort newest version last', () => {
    const candidates = devinBinaryCandidates({
      home: HOME,
      pathEnv: '',
      managedVersions: ['3000.1.0', '3000.13.4', '3000.2.0'],
    });
    const managed = candidates.filter((c) => c.includes('agents/devin'));
    expect(managed).toEqual([
      `${HOME}/.local/share/cairn/agents/devin/3000.13.4/bin/devin`,
      `${HOME}/.local/share/cairn/agents/devin/3000.2.0/bin/devin`,
      `${HOME}/.local/share/cairn/agents/devin/3000.1.0/bin/devin`,
    ]);
  });

  test('dedupes candidates', () => {
    const candidates = devinBinaryCandidates({
      home: HOME,
      pathEnv: `${HOME}/.local/bin`,
      managedVersions: [],
    });
    expect(candidates.filter((c) => c === `${HOME}/.local/bin/devin`)).toHaveLength(1);
  });
});
