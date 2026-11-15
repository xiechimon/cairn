import { describe, expect, test } from 'vitest';
import { desktopReleasesSchema, newestDesktopUpdate } from '../src/desktop-shell.js';

const DIGEST = `sha256:${'ab'.repeat(32)}`;

function release(tag: string, archs: string[], overrides: Record<string, unknown> = {}) {
  const version = tag.replace(/^desktop-v/, '');
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: archs.map((arch) => ({
      name: `Cairn-${version}-${arch}.zip`,
      browser_download_url: `https://github.com/xiechimon/cairn/releases/download/${tag}/Cairn-${version}-${arch}.zip`,
      size: 130_000_000,
      digest: DIGEST,
    })),
    ...overrides,
  };
}

describe('newestDesktopUpdate', () => {
  test('picks the highest desktop release newer than the running version for this arch', () => {
    const releases = desktopReleasesSchema.parse([
      release('desktop-v0.1.9', ['arm64', 'x64']),
      release('desktop-v0.1.12', ['arm64', 'x64']),
      release('desktop-v0.1.10', ['arm64', 'x64']),
    ]);
    expect(newestDesktopUpdate(releases, '0.1.9', 'arm64')).toEqual({
      version: '0.1.12',
      url: 'https://github.com/xiechimon/cairn/releases/download/desktop-v0.1.12/Cairn-0.1.12-arm64.zip',
      size: 130_000_000,
      sha256: 'ab'.repeat(32),
    });
  });

  test('nothing newer, or only the running version, is no update', () => {
    const releases = desktopReleasesSchema.parse([release('desktop-v0.1.9', ['arm64'])]);
    expect(newestDesktopUpdate(releases, '0.1.9', 'arm64')).toBeNull();
    expect(newestDesktopUpdate(releases, '0.1.10', 'arm64')).toBeNull();
  });

  test('skips drafts, prereleases, other tags, a missing arch and a missing digest', () => {
    const releases = desktopReleasesSchema.parse([
      release('desktop-v0.2.0', ['arm64'], { draft: true }),
      release('desktop-v0.2.1', ['arm64'], { prerelease: true }),
      release('cairn-cli@0.9.0', ['arm64']),
      release('desktop-v0.2.2', ['x64']),
      {
        ...release('desktop-v0.2.3', ['arm64']),
        assets: [{ ...release('desktop-v0.2.3', ['arm64']).assets[0], digest: null }],
      },
      release('desktop-v0.1.5', ['arm64']),
    ]);
    expect(newestDesktopUpdate(releases, '0.0.0', 'arm64')?.version).toBe('0.1.5');
  });
});
