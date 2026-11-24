import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { cleanupTestTempDirs, makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  ANTIGRAVITY_ACP_ARGS,
  antigravityCliInstalls,
  antigravityCliTarget,
  antigravityInstallSupported,
  currentAntigravityManagedInstall,
  ensureAntigravityManagedInstall,
  parseAntigravityCliRelease,
  pruneAntigravityVersions,
} from '../src/node/antigravity-install.js';

const tmp = makeTestTempDir('ag-install-');
afterAll(() => cleanupTestTempDirs());

const MANIFEST_BASE = 'https://manifests.example.test/manifests';
const ARCHIVE_PREFIX = 'https://storage.example.test/antigravity-cli/';
const CLI_VERSION = '1.5.16';
const OLD_CLI_VERSION = '1.5.10';

interface Fixture {
  bytes: Buffer;
  sha512: string;
}

function makeTar(dir: string, printedVersion = CLI_VERSION): Fixture {
  const src = join(dir, 'src');
  mkdirSync(src, { recursive: true });
  const bin = join(src, 'antigravity');
  writeFileSync(bin, `#!/bin/sh\necho ${printedVersion}\n`);
  chmodSync(bin, 0o755);
  const archivePath = join(dir, 'cli.tar.gz');
  execFileSync('tar', ['-czf', archivePath, '-C', src, 'antigravity']);
  const bytes = readFileSync(archivePath);
  return { bytes, sha512: createHash('sha512').update(bytes).digest('hex') };
}

function makeExe(): Fixture {
  const bytes = Buffer.from('MZ fake agy exe\n');
  return { bytes, sha512: createHash('sha512').update(bytes).digest('hex') };
}

function archiveUrl(version: string, folder: string, file: string): string {
  return `${ARCHIVE_PREFIX}${version}-1234/${folder}/${file}`;
}

function manifestJson(version: string, url: string, sha512: string): string {
  return JSON.stringify({ version, url, sha512 });
}

const TARGETS = {
  darwinArm64: { target: 'darwin_arm64', folder: 'darwin-arm', file: 'cli_mac_arm64.tar.gz' },
  darwinX64: { target: 'darwin_amd64', folder: 'darwin-x64', file: 'cli_mac_x64.tar.gz' },
  linuxX64: { target: 'linux_amd64', folder: 'linux-x64', file: 'cli_linux_x64.tar.gz' },
  linuxArm64: { target: 'linux_arm64', folder: 'linux-arm', file: 'cli_linux_arm64.tar.gz' },
  linuxX64Musl: {
    target: 'linux_amd64_musl',
    folder: 'linux-x64-musl',
    file: 'cli_linux_x64_musl.tar.gz',
  },
  linuxArm64Musl: {
    target: 'linux_arm64_musl',
    folder: 'linux-arm-musl',
    file: 'cli_linux_arm64_musl.tar.gz',
  },
  winX64: { target: 'windows_amd64', folder: 'windows-x64', file: 'cli_windows_x64.exe' },
  winArm64: { target: 'windows_arm64', folder: 'windows-arm', file: 'cli_windows_arm64.exe' },
} as const;

function fetchImpl(
  manifest: { version: string; url: string; sha512: string } | null,
  fixture: Fixture,
  onManifestUrl?: (url: string) => void,
  countArchive = { n: 0 },
) {
  return async (url: string | URL | Request) => {
    const text = String(url);
    if (text.endsWith('.json')) {
      onManifestUrl?.(text);
      if (manifest === null) return new Response('nope', { status: 500 });
      return new Response(manifestJson(manifest.version, manifest.url, manifest.sha512), {
        status: 200,
      });
    }
    countArchive.n += 1;
    return new Response(new Uint8Array(fixture.bytes), { status: 200 });
  };
}

function cliManifest(fixture: Fixture, version = CLI_VERSION) {
  const { folder, file } = TARGETS.darwinArm64;
  return { version, url: archiveUrl(version, folder, file), sha512: fixture.sha512 };
}

function options(root: string, manifest: ReturnType<typeof cliManifest> | null, fixture: Fixture) {
  return {
    root,
    platform: 'darwin',
    arch: 'arm64',
    manifestBaseUrl: MANIFEST_BASE,
    archiveUrlPrefix: ARCHIVE_PREFIX,
    fetchImpl: fetchImpl(manifest, fixture),
  };
}

describe('antigravity managed install', () => {
  test.each([
    ['darwin', 'arm64', false, TARGETS.darwinArm64, 'antigravity', 'tar.gz'],
    ['darwin', 'x64', false, TARGETS.darwinX64, 'antigravity', 'tar.gz'],
    ['linux', 'x64', false, TARGETS.linuxX64, 'antigravity', 'tar.gz'],
    ['linux', 'arm64', false, TARGETS.linuxArm64, 'antigravity', 'tar.gz'],
    ['linux', 'x64', true, TARGETS.linuxX64Musl, 'antigravity', 'tar.gz'],
    ['linux', 'arm64', true, TARGETS.linuxArm64Musl, 'antigravity', 'tar.gz'],
    ['win32', 'x64', false, TARGETS.winX64, 'agy.exe', 'exe'],
    ['win32', 'arm64', false, TARGETS.winArm64, 'agy.exe', 'exe'],
  ] as const)(
    'resolves channel target and archive layout for %s-%s (musl=%s)',
    (platform, arch, musl, spec, executableName, format) => {
      expect(antigravityInstallSupported(platform, arch)).toBe(true);
      expect(antigravityCliTarget(platform, arch, musl)).toBe(spec.target);
      const parsed = parseAntigravityCliRelease(
        {
          version: CLI_VERSION,
          url: archiveUrl(CLI_VERSION, spec.folder, spec.file),
          sha512: 'a'.repeat(128),
        },
        platform,
        arch,
        musl,
        ARCHIVE_PREFIX,
      );
      expect(parsed).toEqual({
        version: CLI_VERSION,
        url: archiveUrl(CLI_VERSION, spec.folder, spec.file),
        sha512: 'a'.repeat(128),
        executableName,
        format,
      });
    },
  );

  test('rejects unsupported architectures and releases older than 1.5.0', () => {
    expect(antigravityInstallSupported('darwin', 'riscv64')).toBe(false);
    expect(
      parseAntigravityCliRelease(
        {
          version: '1.4.9',
          url: archiveUrl('1.4.9', TARGETS.darwinArm64.folder, TARGETS.darwinArm64.file),
          sha512: 'a'.repeat(128),
        },
        'darwin',
        'arm64',
        false,
        ARCHIVE_PREFIX,
      ),
    ).toBeNull();
  });

  test('installs the full CLI from the release manifest with sha512 verification', async () => {
    const dir = join(tmp, 'happy');
    const fixture = makeTar(dir);
    const root = join(dir, 'managed');
    const seen: string[] = [];
    const install = await ensureAntigravityManagedInstall({
      root,
      platform: 'darwin',
      arch: 'arm64',
      manifestBaseUrl: MANIFEST_BASE,
      archiveUrlPrefix: ARCHIVE_PREFIX,
      fetchImpl: fetchImpl(cliManifest(fixture), fixture, (url) => seen.push(url)),
    });
    expect(seen).toEqual([`${MANIFEST_BASE}/darwin_arm64.json`]);
    expect(install).not.toBeNull();
    expect(install?.version).toBe(CLI_VERSION);
    expect(install?.args).toEqual(ANTIGRAVITY_ACP_ARGS);
    expect(install?.binPath).toBe(join(root, 'versions', CLI_VERSION, 'antigravity'));
    expect(JSON.parse(readFileSync(join(root, 'current.json'), 'utf8'))).toEqual({
      version: CLI_VERSION,
    });
    const marker = JSON.parse(
      readFileSync(join(root, 'versions', CLI_VERSION, '.install-complete'), 'utf8'),
    ) as Record<string, unknown>;
    expect(marker.runtime).toBe('agy-cli');
    expect(marker.archiveSha512).toBe(fixture.sha512);
    expect(currentAntigravityManagedInstall(root)).toEqual(install);
    expect(antigravityCliInstalls(join(root, 'versions'))).toEqual([install]);
  });

  test('refuses a corrupted archive checksum', async () => {
    const dir = join(tmp, 'bad-sum');
    const fixture = makeTar(dir);
    const install = await ensureAntigravityManagedInstall(
      options(join(dir, 'managed'), { ...cliManifest(fixture), sha512: '0'.repeat(128) }, fixture),
    );
    expect(install).toBeNull();
    expect(currentAntigravityManagedInstall(join(dir, 'managed'))).toBeNull();
  });

  test('refuses an archive url outside the release prefix', async () => {
    const dir = join(tmp, 'bad-url');
    const fixture = makeTar(dir);
    const manifest = { ...cliManifest(fixture), url: 'https://evil.example.test/cli.tar.gz' };
    const install = await ensureAntigravityManagedInstall(
      options(join(dir, 'managed'), manifest, fixture),
    );
    expect(install).toBeNull();
  });

  test('refuses an archive path that does not match the target layout', async () => {
    const dir = join(tmp, 'bad-layout');
    const fixture = makeTar(dir);
    const manifest = {
      ...cliManifest(fixture),
      url: archiveUrl(CLI_VERSION, 'windows-x64', 'cli_windows_x64.exe'),
    };
    const install = await ensureAntigravityManagedInstall(
      options(join(dir, 'managed'), manifest, fixture),
    );
    expect(install).toBeNull();
  });

  test('rejects a malformed manifest version or tarball containing a symlink', async () => {
    const dir = join(tmp, 'bad-version');
    const fixture = makeTar(dir);
    const manifest = { ...cliManifest(fixture), version: 'latest' };
    expect(
      await ensureAntigravityManagedInstall(options(join(dir, 'managed'), manifest, fixture)),
    ).toBeNull();

    const outside = join(dir, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'antigravity'), `#!/bin/sh\necho ${CLI_VERSION}\n`);
    const src = join(dir, 'sym-src');
    mkdirSync(src, { recursive: true });
    symlinkSync(outside, join(src, 'bin'));
    const archivePath = join(dir, 'sym.tar.gz');
    execFileSync('tar', ['-czf', archivePath, '-C', src, 'bin']);
    const symBytes = readFileSync(archivePath);
    const symFixture: Fixture = {
      bytes: symBytes,
      sha512: createHash('sha512').update(symBytes).digest('hex'),
    };
    expect(
      await ensureAntigravityManagedInstall(
        options(join(dir, 'sym-managed'), cliManifest(symFixture), symFixture),
      ),
    ).toBeNull();
  });

  test('resolves the windows target to the raw exe download', async () => {
    const dir = join(tmp, 'windows');
    const fixture = makeExe();
    const { target, folder, file } = TARGETS.winX64;
    const manifest = {
      version: CLI_VERSION,
      url: archiveUrl(CLI_VERSION, folder, file),
      sha512: fixture.sha512,
    };
    const seen: string[] = [];
    const install = await ensureAntigravityManagedInstall({
      root: join(dir, 'managed'),
      platform: 'win32',
      arch: 'x64',
      manifestBaseUrl: MANIFEST_BASE,
      archiveUrlPrefix: ARCHIVE_PREFIX,
      fetchImpl: fetchImpl(manifest, fixture, (url) => seen.push(url)),
      versionProbe: false,
    });
    expect(seen).toEqual([`${MANIFEST_BASE}/${target}.json`]);
    expect(install?.binPath).toBe(join(dir, 'managed', 'versions', CLI_VERSION, 'agy.exe'));
  });

  test('resolves the musl linux target', async () => {
    const dir = join(tmp, 'musl');
    const fixture = makeTar(dir);
    const { target, folder, file } = TARGETS.linuxX64Musl;
    const manifest = {
      version: CLI_VERSION,
      url: archiveUrl(CLI_VERSION, folder, file),
      sha512: fixture.sha512,
    };
    const seen: string[] = [];
    const install = await ensureAntigravityManagedInstall({
      root: join(dir, 'managed'),
      platform: 'linux',
      arch: 'x64',
      musl: true,
      manifestBaseUrl: MANIFEST_BASE,
      archiveUrlPrefix: ARCHIVE_PREFIX,
      fetchImpl: fetchImpl(manifest, fixture, (url) => seen.push(url)),
    });
    expect(seen).toEqual([`${MANIFEST_BASE}/${target}.json`]);
    expect(install?.version).toBe(CLI_VERSION);
  });

  test('keeps the current install when the channel offers the same or older version', async () => {
    const dir = join(tmp, 'reuse');
    const fixture = makeTar(dir);
    const root = join(dir, 'managed');
    const first = await ensureAntigravityManagedInstall(
      options(root, cliManifest(fixture), fixture),
    );
    const archiveFetches = { n: 0 };
    const second = await ensureAntigravityManagedInstall({
      ...options(root, cliManifest(fixture), fixture),
      fetchImpl: fetchImpl(cliManifest(fixture), fixture, undefined, archiveFetches),
    });
    expect(second).toEqual(first);
    expect(archiveFetches.n).toBe(0);

    const older = {
      ...cliManifest(fixture),
      version: '1.5.9',
      url: archiveUrl('1.5.9', 'darwin-arm', 'cli_mac_arm64.tar.gz'),
    };
    const kept = await ensureAntigravityManagedInstall({
      ...options(root, older, fixture),
      fetchImpl: fetchImpl(older, fixture, undefined, archiveFetches),
    });
    expect(kept?.version).toBe(CLI_VERSION);
    expect(archiveFetches.n).toBe(0);
  });

  test('installs a newer release beside a protected active version and prunes once released', async () => {
    const dir = join(tmp, 'update-protected');
    const oldFixture = makeTar(dir, OLD_CLI_VERSION);
    const root = join(dir, 'managed');
    const oldManifest = {
      version: OLD_CLI_VERSION,
      url: archiveUrl(OLD_CLI_VERSION, 'darwin-arm', 'cli_mac_arm64.tar.gz'),
      sha512: oldFixture.sha512,
    };
    await ensureAntigravityManagedInstall(options(root, oldManifest, oldFixture));

    const newFixture = makeTar(join(dir, 'next'));
    const install = await ensureAntigravityManagedInstall({
      ...options(root, cliManifest(newFixture), newFixture),
      protectedVersions: () => [OLD_CLI_VERSION],
    });
    expect(install?.version).toBe(CLI_VERSION);
    expect(JSON.parse(readFileSync(join(root, 'current.json'), 'utf8'))).toEqual({
      version: CLI_VERSION,
    });
    expect(existsSync(join(root, 'versions', OLD_CLI_VERSION))).toBe(true);
    expect(existsSync(join(root, 'versions', CLI_VERSION))).toBe(true);

    pruneAntigravityVersions(root);
    expect(existsSync(join(root, 'versions', OLD_CLI_VERSION))).toBe(false);
    expect(existsSync(join(root, 'versions', CLI_VERSION))).toBe(true);
  });

  test('a failed validation keeps the previous runtime', async () => {
    const dir = join(tmp, 'bad-validation');
    const oldFixture = makeTar(dir, OLD_CLI_VERSION);
    const root = join(dir, 'managed');
    const oldManifest = {
      version: OLD_CLI_VERSION,
      url: archiveUrl(OLD_CLI_VERSION, 'darwin-arm', 'cli_mac_arm64.tar.gz'),
      sha512: oldFixture.sha512,
    };
    const before = await ensureAntigravityManagedInstall(options(root, oldManifest, oldFixture));

    const newFixture = makeTar(join(dir, 'next'));
    const install = await ensureAntigravityManagedInstall({
      ...options(root, cliManifest(newFixture), newFixture),
      validate: async () => false,
    });
    expect(install?.version).toBe(OLD_CLI_VERSION);
    expect(JSON.parse(readFileSync(join(root, 'current.json'), 'utf8'))).toEqual({
      version: OLD_CLI_VERSION,
    });
    expect(existsSync(join(root, 'versions', CLI_VERSION))).toBe(false);
    expect(currentAntigravityManagedInstall(root)).toEqual(before);
  });

  test('a binary reporting a different version fails validation', async () => {
    const dir = join(tmp, 'version-lie');
    const fixture = makeTar(dir, '0.0.0');
    const install = await ensureAntigravityManagedInstall(
      options(join(dir, 'managed'), cliManifest(fixture), fixture),
    );
    expect(install).toBeNull();
  });

  test('a registry-pack install is invisible to the cli resolver and replaced on ensure', async () => {
    const dir = join(tmp, 'legacy');
    const root = join(dir, 'managed');
    const versionDir = join(root, 'versions', '1.5.2');
    mkdirSync(join(versionDir, 'bin'), { recursive: true });
    const par = join(versionDir, 'bin', 'agy_acp_server.par');
    writeFileSync(par, 'par-bytes');
    const parSha = createHash('sha256').update(readFileSync(par)).digest('hex');
    writeFileSync(
      join(versionDir, '.install-complete'),
      JSON.stringify({
        version: '1.5.2',
        url: 'https://dl.google.com/legacy.tar.gz',
        archiveSha256: 'x',
        binRelPath: 'bin/agy_acp_server.par',
        binSha256: parSha,
        args: [],
        installedAt: 1,
      }),
    );
    writeFileSync(join(root, 'current.json'), JSON.stringify({ version: '1.5.2' }));
    writeFileSync(join(root, 'registry-cache.json'), '{}');
    expect(currentAntigravityManagedInstall(root)).toBeNull();
    expect(antigravityCliInstalls(join(root, 'versions'))).toEqual([]);

    const fixture = makeTar(join(dir, 'fixture'));
    const install = await ensureAntigravityManagedInstall(
      options(root, cliManifest(fixture), fixture),
    );
    expect(install?.version).toBe(CLI_VERSION);
    expect(existsSync(versionDir)).toBe(false);
    expect(existsSync(join(root, 'registry-cache.json'))).toBe(false);
  });

  test('falls back to the cached manifest when the channel is unreachable', async () => {
    const dir = join(tmp, 'cache');
    const fixture = makeTar(dir);
    const root = join(dir, 'managed');
    await ensureAntigravityManagedInstall(options(root, cliManifest(fixture), fixture));
    const cached = JSON.parse(readFileSync(join(root, 'channel-cache.json'), 'utf8')) as {
      version?: unknown;
    };
    expect(cached.version).toBe(CLI_VERSION);

    const offlineDir = join(dir, 'offline');
    const offlineRoot = join(offlineDir, 'managed');
    mkdirSync(offlineRoot, { recursive: true });
    writeFileSync(
      join(offlineRoot, 'channel-cache.json'),
      readFileSync(join(root, 'channel-cache.json')),
    );
    const install = await ensureAntigravityManagedInstall(options(offlineRoot, null, fixture));
    expect(install?.version).toBe(CLI_VERSION);
  });
});
