import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createGeminiManaged } from '../src/backend/gemini-managed.js';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) releaseTestTempDir(dir);
});

const REGISTRY_BODY = {
  agents: [
    {
      id: 'gemini',
      version: '0.70.0',
      distribution: { npx: { package: '@google/gemini-cli@0.70.0', args: ['--acp'] } },
    },
  ],
};

function makeTarball(dir: string, body = '// gemini bundle\n'): Buffer {
  const src = join(dir, 'pkg-src');
  mkdirSync(join(src, 'package', 'bundle'), { recursive: true });
  writeFileSync(join(src, 'package', 'bundle', 'gemini.js'), body);
  const out = join(dir, 'pkg.tgz');
  execFileSync('tar', ['-czf', out, '-C', src, 'package']);
  return readFileSync(out);
}

function fetchFor(tarball: Buffer | null, tarballUrl = 'https://example.invalid/g.tgz') {
  return async (url: Parameters<typeof fetch>[0]) => {
    const u = String(url);
    if (u.endsWith('registry.json')) {
      return new Response(JSON.stringify(REGISTRY_BODY), { status: 200 });
    }
    if (u.includes('gemini-cli')) {
      return new Response(
        JSON.stringify({
          dist: {
            tarball: tarballUrl,
            ...(tarball !== null
              ? { shasum: createHash('sha1').update(tarball).digest('hex') }
              : { shasum: '0'.repeat(40) }),
          },
        }),
        { status: 200 },
      );
    }
    return new Response(tarball ?? Buffer.alloc(0), { status: tarball === null ? 200 : 200 });
  };
}

describe('gemini managed install', () => {
  test('current() is null with no install', () => {
    const dir = tempDir('gm-empty-');
    const managed = createGeminiManaged({ root: join(dir, 'tools') });
    expect(managed.current()).toBeNull();
  });

  test('ensure() installs from the npm tarball and launches node bundle --acp', async () => {
    const dir = tempDir('gm-inst-');
    const tarball = makeTarball(dir);
    const managed = createGeminiManaged({
      root: join(dir, 'tools'),
      nodePath: '/usr/local/bin/node',
      fetchImpl: fetchFor(tarball),
    });
    const install = await managed.ensure();
    expect(install?.version).toBe('0.70.0');
    expect(install?.command).toBe('/usr/local/bin/node');
    expect(install?.args[0]).toBe(join(dir, 'tools', 'versions', '0.70.0', 'bundle', 'gemini.js'));
    expect(install?.args[1]).toBe('--acp');
    expect(managed.current()).toEqual(install);
  });

  test('rejects a tarball whose checksum does not match npm metadata', async () => {
    const dir = tempDir('gm-sha-');
    const managed = createGeminiManaged({
      root: join(dir, 'tools'),
      fetchImpl: fetchFor(null),
    });
    expect(await managed.ensure()).toBeNull();
  });

  test('returns null when the registry has no npx distribution', async () => {
    const dir = tempDir('gm-nodist-');
    const managed = createGeminiManaged({
      root: join(dir, 'tools'),
      fetchImpl: async () =>
        new Response(JSON.stringify({ agents: [{ id: 'gemini', version: '0.70.0' }] }), {
          status: 200,
        }),
    });
    expect(await managed.ensure()).toBeNull();
  });

  test('current() falls back to the newest versioned install without current.json', async () => {
    const dir = tempDir('gm-cur-');
    const versionDir = join(dir, 'tools', 'versions', '0.70.0');
    mkdirSync(join(versionDir, 'bundle'), { recursive: true });
    writeFileSync(join(versionDir, 'bundle', 'gemini.js'), '// bundle\n');
    writeFileSync(
      join(versionDir, '.install-complete'),
      JSON.stringify({
        version: '0.70.0',
        url: 'https://example.invalid/g.tgz',
        binRelPath: 'bundle/gemini.js',
        args: ['--acp'],
        installedAt: Date.now(),
      }),
    );
    const managed = createGeminiManaged({ root: join(dir, 'tools'), nodePath: '/node' });
    const current = managed.current();
    expect(current?.version).toBe('0.70.0');
    expect(current?.args[0]).toBe(join(versionDir, 'bundle', 'gemini.js'));
  });
});
