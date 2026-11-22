import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { cleanupTestTempDirs, makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  antigravityInstallSupported,
  currentAntigravityManagedInstall,
  ensureAntigravityManagedInstall,
} from '../src/node/antigravity-install.js';

const tmp = makeTestTempDir('ag-install-');
afterAll(() => cleanupTestTempDirs());

interface FixtureArchive {
  bytes: Buffer;
  sha256: string;
}

function makeArchive(dir: string): FixtureArchive {
  const src = join(dir, 'src');
  mkdirSync(join(src, 'bin'), { recursive: true });
  const bin = join(src, 'bin', 'antigravity-acp');
  writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  chmodSync(bin, 0o755);
  const archivePath = join(dir, 'ag.tar.gz');
  execFileSync('tar', ['-czf', archivePath, '-C', src, 'bin']);
  const bytes = readFileSync(archivePath);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function registryJson(archiveSha256: string, version = '1.5.10'): string {
  return JSON.stringify({
    agents: [
      {
        id: 'antigravity-acp',
        version,
        distribution: {
          binary: {
            'darwin-aarch64': {
              archive: 'https://example.invalid/ag.tar.gz',
              cmd: './bin/antigravity-acp',
              sha256: archiveSha256,
            },
          },
        },
      },
    ],
  });
}

function fetchImpl(archive: FixtureArchive) {
  return async (url: string | URL | Request) => {
    if (String(url).endsWith('registry.json')) {
      return new Response(registryJson(archive.sha256), { status: 200 });
    }
    return new Response(new Uint8Array(archive.bytes), { status: 200 });
  };
}

describe('antigravity managed install', () => {
  test('install support follows the registry platform key', () => {
    expect(antigravityInstallSupported('darwin', 'arm64')).toBe(true);
    expect(antigravityInstallSupported('linux', 'x64')).toBe(true);
    expect(antigravityInstallSupported('win32', 'x64')).toBe(false);
    expect(antigravityInstallSupported('darwin', 'riscv64')).toBe(false);
  });

  test('installs from the registry with checksum verification and a current marker', async () => {
    const dir = join(tmp, 'happy');
    const archive = makeArchive(dir);
    const root = join(dir, 'managed');
    const install = await ensureAntigravityManagedInstall({
      root,
      platform: 'darwin',
      arch: 'arm64',
      registryUrl: 'https://example.invalid/registry.json',
      archiveHost: 'example.invalid',
      fetchImpl: fetchImpl(archive),
    });
    expect(install).toMatchObject({ version: '1.5.10', args: [] });
    expect(install?.binPath).toBe(join(root, 'versions', '1.5.10', 'bin', 'antigravity-acp'));
    expect(JSON.parse(readFileSync(join(root, 'current.json'), 'utf8'))).toEqual({
      version: '1.5.10',
    });
    expect(currentAntigravityManagedInstall(root)).toEqual(install);
  });

  test('refuses a corrupted archive checksum and cleans staging', async () => {
    const dir = join(tmp, 'bad-sum');
    const archive = makeArchive(dir);
    const root = join(dir, 'managed');
    const install = await ensureAntigravityManagedInstall({
      root,
      platform: 'darwin',
      arch: 'arm64',
      registryUrl: 'https://example.invalid/registry.json',
      archiveHost: 'example.invalid',
      fetchImpl: async (url) => {
        if (String(url).endsWith('registry.json')) {
          return new Response(registryJson('0'.repeat(64)), { status: 200 });
        }
        return new Response(new Uint8Array(archive.bytes), { status: 200 });
      },
    });
    expect(install).toBeNull();
    expect(currentAntigravityManagedInstall(root)).toBeNull();
  });

  test('refuses an archive url on an untrusted host', async () => {
    const dir = join(tmp, 'bad-host');
    const archive = makeArchive(dir);
    const install = await ensureAntigravityManagedInstall({
      root: join(dir, 'managed'),
      platform: 'darwin',
      arch: 'arm64',
      registryUrl: 'https://example.invalid/registry.json',
      archiveHost: 'dl.google.com',
      fetchImpl: fetchImpl(archive),
    });
    expect(install).toBeNull();
  });

  test('returns null when the platform has no registry binary entry', async () => {
    const dir = join(tmp, 'no-platform');
    const archive = makeArchive(dir);
    const install = await ensureAntigravityManagedInstall({
      root: join(dir, 'managed'),
      platform: 'win32',
      arch: 'x64',
      registryUrl: 'https://example.invalid/registry.json',
      archiveHost: 'example.invalid',
      fetchImpl: fetchImpl(archive),
    });
    expect(install).toBeNull();
  });

  test('an existing verified install is reused without a download', async () => {
    const dir = join(tmp, 'reuse');
    const archive = makeArchive(dir);
    const root = join(dir, 'managed');
    const first = await ensureAntigravityManagedInstall({
      root,
      platform: 'darwin',
      arch: 'arm64',
      registryUrl: 'https://example.invalid/registry.json',
      archiveHost: 'example.invalid',
      fetchImpl: fetchImpl(archive),
    });
    let fetches = 0;
    const second = await ensureAntigravityManagedInstall({
      root,
      platform: 'darwin',
      arch: 'arm64',
      registryUrl: 'https://example.invalid/registry.json',
      archiveHost: 'example.invalid',
      fetchImpl: async () => {
        fetches += 1;
        return new Response('nope', { status: 500 });
      },
    });
    expect(second).toEqual(first);
    expect(fetches).toBe(0);
  });
});
