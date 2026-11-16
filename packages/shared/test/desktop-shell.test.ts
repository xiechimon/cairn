import { describe, expect, test } from 'vitest';
import { desktopReleaseManifestSchema, desktopUpdateFrom } from '../src/desktop-shell.js';

const SHA = 'ab'.repeat(32);

function manifest(version: string, archs: string[]) {
  return desktopReleaseManifestSchema.parse({
    version,
    files: Object.fromEntries(
      archs.map((arch) => [
        arch,
        { name: `Cairn-${version}-${arch}.zip`, size: 130_000_000, sha256: SHA },
      ]),
    ),
  });
}

describe('desktopUpdateFrom', () => {
  test('a newer manifest yields the download for the running arch', () => {
    expect(desktopUpdateFrom(manifest('0.1.12', ['arm64', 'x64']), '0.1.9', 'arm64')).toEqual({
      version: '0.1.12',
      url: 'https://github.com/xiechimon/cairn/releases/download/desktop-v0.1.12/Cairn-0.1.12-arm64.zip',
      size: 130_000_000,
      sha256: SHA,
    });
  });

  test('the running version or an older one is no update', () => {
    expect(desktopUpdateFrom(manifest('0.1.9', ['arm64']), '0.1.9', 'arm64')).toBeNull();
    expect(desktopUpdateFrom(manifest('0.1.9', ['arm64']), '0.1.10', 'arm64')).toBeNull();
  });

  test('a manifest without the running arch is no update', () => {
    expect(desktopUpdateFrom(manifest('0.2.0', ['x64']), '0.1.0', 'arm64')).toBeNull();
  });
});

describe('desktopReleaseManifestSchema', () => {
  test('rejects a non-semver version, a bad digest, a non-zip name and unknown keys', () => {
    const file = { name: 'Cairn-0.2.0-arm64.zip', size: 1, sha256: SHA };
    expect(
      desktopReleaseManifestSchema.safeParse({ version: 'v0.2', files: { arm64: file } }).success,
    ).toBe(false);
    expect(
      desktopReleaseManifestSchema.safeParse({
        version: '0.2.0',
        files: { arm64: { ...file, sha256: 'abc' } },
      }).success,
    ).toBe(false);
    expect(
      desktopReleaseManifestSchema.safeParse({
        version: '0.2.0',
        files: { arm64: { ...file, name: '../evil.zip' } },
      }).success,
    ).toBe(false);
    expect(
      desktopReleaseManifestSchema.safeParse({
        version: '0.2.0',
        files: { arm64: file },
        url: 'https://x',
      }).success,
    ).toBe(false);
  });
});
