import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createDevinManaged } from '../src/backend/devin-managed.js';

const roots: string[] = [];

function workspace() {
  const dir = makeTestTempDir('cairn-devin-managed-');
  roots.push(dir);
  const pkg = join(dir, 'pkg', 'bin');
  mkdirSync(pkg, { recursive: true });
  const bin = join(pkg, 'devin');
  writeFileSync(bin, '#!/bin/sh\necho devin\n', { mode: 0o755 });
  const tarball = join(dir, 'devin.tar.gz');
  execFileSync('tar', ['-czf', tarball, '-C', join(dir, 'pkg'), '.']);
  return { dir, tarball };
}

const registry = (archive: string, version = '3000.0.1') =>
  JSON.stringify({
    version: 1,
    agents: [
      {
        id: 'devin',
        name: 'Devin',
        version,
        distribution: {
          binary: {
            'darwin-aarch64': { archive, cmd: './bin/devin', args: ['acp'] },
          },
        },
      },
    ],
  });

afterEach(() => {
  for (const dir of roots.splice(0)) releaseTestTempDir(dir);
});

describe('devin managed install', () => {
  test('downloads the registry entry, verifies and installs into a private root', async () => {
    const { dir, tarball } = workspace();
    const bytes = new Uint8Array(await import('node:fs').then((fs) => fs.readFileSync(tarball)));
    const requests: string[] = [];
    const managed = createDevinManaged({
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes('registry.json')) return new Response(registry('https://x/devin.tgz'));
        return new Response(bytes);
      },
    });
    const install = await managed.ensure();
    expect(install).not.toBeNull();
    expect(install?.version).toBe('3000.0.1');
    expect(install?.args).toEqual(['acp']);
    expect(install?.binPath.endsWith(join('bin', 'devin'))).toBe(true);
    expect(managed.current()?.binPath).toBe(install?.binPath);
    expect(requests).toHaveLength(2);
  });

  test('reuses a verified install without re-downloading', async () => {
    const { dir, tarball } = workspace();
    const { readFileSync } = await import('node:fs');
    const bytes = new Uint8Array(readFileSync(tarball));
    let downloads = 0;
    const managed = createDevinManaged({
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('registry.json')) return new Response(registry('https://x/devin.tgz'));
        downloads += 1;
        return new Response(bytes);
      },
    });
    await managed.ensure();
    await managed.ensure();
    expect(downloads).toBe(1);
  });

  test('falls back to the cached install when the registry is unreachable', async () => {
    const { dir, tarball } = workspace();
    const { readFileSync } = await import('node:fs');
    const bytes = new Uint8Array(readFileSync(tarball));
    let online = true;
    const managed = createDevinManaged({
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        if (!online) throw new Error('offline');
        const url = String(input);
        if (url.includes('registry.json')) return new Response(registry('https://x/devin.tgz'));
        return new Response(bytes);
      },
    });
    await managed.ensure();
    online = false;
    expect(await managed.ensure()).not.toBeNull();
    expect(managed.current()).not.toBeNull();
  });

  test('rejects a tampered cached binary instead of running it', async () => {
    const { dir, tarball } = workspace();
    const { readFileSync, writeFileSync: write } = await import('node:fs');
    const bytes = new Uint8Array(readFileSync(tarball));
    const managed = createDevinManaged({
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('registry.json')) return new Response(registry('https://x/devin.tgz'));
        return new Response(bytes);
      },
    });
    const install = await managed.ensure();
    expect(install).not.toBeNull();
    write(install!.binPath, 'tampered');
    expect(managed.current()).toBeNull();
    expect(await managed.ensure()).not.toBeNull();
  });
});
