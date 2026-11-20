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

const manifest = (url: string, sha256: string, version = '3000.0.2') =>
  JSON.stringify({
    version,
    platforms: {
      'aarch64-apple-darwin': { url, sha256 },
      'x86_64-apple-darwin': { url: `${url}-x64`, sha256 },
    },
  });

const registry = (archive: string, version = '3000.0.1') =>
  JSON.stringify({
    version: 1,
    agents: [
      {
        id: 'codex',
        name: 'Codex',
        version: '0.0.1',
        distribution: { npm: { package: '@zed/codex-acp' } },
      },
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
  test('installs from the official manifest with checksum verification', async () => {
    const { dir, tarball } = workspace();
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const bytes = new Uint8Array(readFileSync(tarball));
    const sha = createHash('sha256').update(bytes).digest('hex');
    const requests: string[] = [];
    const managed = createDevinManaged({
      archiveHost: 'x',
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes('manifest.json'))
          return new Response(manifest('https://x/devin.tgz', sha));
        if (url.includes('registry.json')) return new Response(registry('https://x/devin.tgz'));
        return new Response(bytes);
      },
    });
    const install = await managed.ensure();
    expect(install).not.toBeNull();
    expect(install?.version).toBe('3000.0.2');
    expect(install?.args).toEqual(['acp']);
    expect(install?.binPath.endsWith(join('bin', 'devin'))).toBe(true);
    const marker = JSON.parse(
      readFileSync(join(install!.binPath, '..', '..', '.install-complete'), 'utf8'),
    );
    expect(marker.archiveSha256).toBe(sha);
    expect(requests.some((url) => url.includes('devin.tgz'))).toBe(true);
  });

  test('refuses an archive whose bytes do not match the manifest checksum', async () => {
    const { dir, tarball } = workspace();
    const { readFileSync } = await import('node:fs');
    const bytes = new Uint8Array(readFileSync(tarball));
    const managed = createDevinManaged({
      archiveHost: 'x',
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('manifest.json'))
          return new Response(manifest('https://x/devin.tgz', '0'.repeat(64)));
        if (url.includes('registry.json')) throw new Error('registry unreachable');
        return new Response(bytes);
      },
    });
    expect(await managed.ensure()).toBeNull();
    expect(managed.current()).toBeNull();
  });

  test('falls back to the registry spec when the manifest is unavailable', async () => {
    const { dir, tarball } = workspace();
    const { readFileSync } = await import('node:fs');
    const bytes = new Uint8Array(readFileSync(tarball));
    const managed = createDevinManaged({
      archiveHost: 'x',
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('manifest.json')) throw new Error('manifest down');
        if (url.includes('registry.json')) return new Response(registry('https://x/devin.tgz'));
        return new Response(bytes);
      },
    });
    const install = await managed.ensure();
    expect(install?.version).toBe('3000.0.1');
  });

  test('falls back to the registry spec when the manifest archive 403s', async () => {
    const { dir, tarball } = workspace();
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const bytes = new Uint8Array(readFileSync(tarball));
    const managed = createDevinManaged({
      archiveHost: 'x',
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('manifest.json'))
          return new Response(
            manifest('https://x/dead.tgz', createHash('sha256').update(bytes).digest('hex')),
          );
        if (url.includes('registry.json')) return new Response(registry('https://x/devin.tgz'));
        if (url.includes('dead.tgz')) return new Response('denied', { status: 403 });
        return new Response(bytes);
      },
    });
    const install = await managed.ensure();
    expect(install?.version).toBe('3000.0.1');
  });

  test('downloads the registry entry, verifies and installs into a private root', async () => {
    const { dir, tarball } = workspace();
    const bytes = new Uint8Array(await import('node:fs').then((fs) => fs.readFileSync(tarball)));
    const requests: string[] = [];
    const managed = createDevinManaged({
      archiveHost: 'x',
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes('manifest.json')) throw new Error('manifest down');
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
    expect(requests).toHaveLength(3);
  });

  test('reuses a verified install without re-downloading', async () => {
    const { dir, tarball } = workspace();
    const { readFileSync } = await import('node:fs');
    const bytes = new Uint8Array(readFileSync(tarball));
    let downloads = 0;
    const managed = createDevinManaged({
      archiveHost: 'x',
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('manifest.json')) throw new Error('manifest down');
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
      archiveHost: 'x',
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        if (!online) throw new Error('offline');
        const url = String(input);
        if (url.includes('manifest.json')) throw new Error('manifest down');
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
      archiveHost: 'x',
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('manifest.json')) throw new Error('manifest down');
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

  test('rejects manifest and registry archives hosted off the trusted host', async () => {
    const { dir, tarball } = workspace();
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const bytes = new Uint8Array(readFileSync(tarball));
    const sha = createHash('sha256').update(bytes).digest('hex');
    const fetched: string[] = [];
    const managed = createDevinManaged({
      archiveHost: 'static.devin.ai',
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        const url = String(input);
        fetched.push(url);
        if (url.includes('manifest.json'))
          return new Response(manifest('https://evil.example/devin.tgz', sha));
        if (url.includes('registry.json'))
          return new Response(registry('https://evil.example/devin.tgz'));
        return new Response(bytes);
      },
    });
    expect(await managed.ensure()).toBeNull();
    expect(fetched.some((url) => url.includes('evil.example/devin.tgz'))).toBe(false);
  });

  test('rejects an http archive url even on the trusted host', async () => {
    const { dir, tarball } = workspace();
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const bytes = new Uint8Array(readFileSync(tarball));
    const sha = createHash('sha256').update(bytes).digest('hex');
    const managed = createDevinManaged({
      archiveHost: 'x',
      root: join(dir, 'install'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('manifest.json')) return new Response(manifest('http://x/devin.tgz', sha));
        if (url.includes('registry.json')) return new Response(registry('http://x/devin.tgz'));
        return new Response(bytes);
      },
    });
    expect(await managed.ensure()).toBeNull();
  });

  test('rejects a current.json version that escapes the versions directory', async () => {
    const { dir } = workspace();
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const root = join(dir, 'install');
    const escaped = join(root, 'escaped');
    mkdirSync(join(escaped, 'bin'), { recursive: true });
    const bin = join(escaped, 'bin', 'devin');
    writeFileSync(bin, '#!/bin/sh\n');
    writeFileSync(
      join(escaped, '.install-complete'),
      JSON.stringify({
        version: 'evil',
        url: 'https://x/devin.tgz',
        archiveSha256: '0'.repeat(64),
        binRelPath: 'bin/devin',
        binSha256: createHash('sha256').update(readFileSync(bin)).digest('hex'),
        args: ['acp'],
        installedAt: 1,
      }),
    );
    writeFileSync(join(root, 'current.json'), JSON.stringify({ version: '../escaped' }));
    const managed = createDevinManaged({
      archiveHost: 'x',
      root,
      platform: 'darwin',
      arch: 'arm64',
    });
    expect(managed.current()).toBeNull();
  });
});
