import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ANTIGRAVITY_MODELS } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createAntigravityManaged } from '../src/backend/antigravity-managed.js';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) releaseTestTempDir(dir);
});

describe('antigravity managed binary resolution', () => {
  test('prefers local agy binary on ~/.local/bin and probes authenticated status & models', async () => {
    const dir = tempDir('ag-local-');
    const home = join(dir, 'home');
    const binDir = join(home, '.local', 'bin');
    mkdirSync(binDir, { recursive: true });
    const agy = join(binDir, 'agy');
    writeFileSync(agy, '#!/bin/sh\nexit 0\n');
    chmodSync(agy, 0o755);

    const fetched: string[] = [];
    const managed = createAntigravityManaged({
      home,
      pathEnv: '',
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (url) => {
        fetched.push(String(url));
        return new Response('{}', { status: 500 });
      },
      probeBinary: async (binPath, args, source) => ({
        version: '1.5.10',
        binPath,
        args,
        source,
        authenticated: true,
        models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
      }),
    });

    const beforeEnsure = managed.current();
    expect(beforeEnsure).toMatchObject({ binPath: agy, source: 'local' });

    const ensured = await managed.ensure();
    expect(ensured).toMatchObject({
      binPath: agy,
      args: ['acp'],
      source: 'local',
      version: '1.5.10',
      authenticated: true,
    });
    expect(ensured?.models).toHaveLength(9);
    expect(fetched).toHaveLength(0);
  });

  test('downloads .tar.gz from ACP registry with sha256 verification when local binary is absent', async () => {
    const dir = tempDir('ag-reg-');
    const home = join(dir, 'home');
    const src = join(dir, 'src');
    mkdirSync(join(src, 'bin'), { recursive: true });
    const bin = join(src, 'bin', 'antigravity-acp');
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);
    const archivePath = join(dir, 'ag.tar.gz');
    execFileSync('tar', ['-czf', archivePath, '-C', src, 'bin']);
    const archiveBytes = readFileSync(archivePath);
    const archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex');

    const managed = createAntigravityManaged({
      home,
      pathEnv: '',
      platform: 'darwin',
      arch: 'arm64',
      registryUrl: 'https://example.invalid/registry.json',
      fetchImpl: async (url) => {
        if (String(url).endsWith('registry.json')) {
          return new Response(
            JSON.stringify({
              agents: [
                {
                  id: 'antigravity-acp',
                  version: '1.5.10',
                  distribution: {
                    binary: {
                      'darwin-aarch64': {
                        archive: 'https://example.invalid/ag.tar.gz',
                        cmd: './bin/antigravity-acp',
                        args: ['acp'],
                        sha256: archiveSha256,
                      },
                    },
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(archiveBytes, { status: 200 });
      },
      probeBinary: async (binPath, args, source, knownVersion) => ({
        version: knownVersion ?? '1.5.10',
        binPath,
        args,
        source,
        authenticated: false,
        models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
      }),
    });

    const install = await managed.ensure();
    expect(install).toMatchObject({
      version: '1.5.10',
      args: ['acp'],
      source: 'managed',
      authenticated: false,
    });
  });

  test('downloads .zip from ACP registry and rejects checksum mismatches', async () => {
    const dir = tempDir('ag-zip-');
    const home = join(dir, 'home');
    const src = join(dir, 'src');
    mkdirSync(join(src, 'bin'), { recursive: true });
    writeFileSync(join(src, 'bin', 'antigravity-acp'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(src, 'bin', 'antigravity-acp'), 0o755);
    const zipPath = join(dir, 'ag.zip');
    execFileSync('zip', ['-q', '-r', zipPath, 'bin'], { cwd: src });
    const zipBytes = readFileSync(zipPath);
    const validSha = createHash('sha256').update(zipBytes).digest('hex');

    const badManaged = createAntigravityManaged({
      home: join(dir, 'bad-home'),
      pathEnv: '',
      platform: 'darwin',
      arch: 'arm64',
      registryUrl: 'https://example.invalid/registry.json',
      fetchImpl: async (url) =>
        String(url).endsWith('registry.json')
          ? new Response(
              JSON.stringify({
                agents: [
                  {
                    id: 'antigravity-acp',
                    version: '1.5.10',
                    distribution: {
                      binary: {
                        'darwin-aarch64': {
                          archive: 'https://example.invalid/ag.zip',
                          cmd: './bin/antigravity-acp',
                          sha256: '0'.repeat(64),
                        },
                      },
                    },
                  },
                ],
              }),
              { status: 200 },
            )
          : new Response(zipBytes, { status: 200 }),
    });
    await expect(badManaged.ensure()).resolves.toBeNull();

    const goodManaged = createAntigravityManaged({
      home,
      pathEnv: '',
      platform: 'darwin',
      arch: 'arm64',
      registryUrl: 'https://example.invalid/registry.json',
      fetchImpl: async (url) =>
        String(url).endsWith('registry.json')
          ? new Response(
              JSON.stringify({
                agents: [
                  {
                    id: 'antigravity-acp',
                    version: '1.5.10',
                    distribution: {
                      binary: {
                        'darwin-aarch64': {
                          archive: 'https://example.invalid/ag.zip',
                          cmd: './bin/antigravity-acp',
                          sha256: validSha,
                        },
                      },
                    },
                  },
                ],
              }),
              { status: 200 },
            )
          : new Response(zipBytes, { status: 200 }),
      probeBinary: async (binPath, args, source, knownVersion) => ({
        version: knownVersion ?? '1.5.10',
        binPath,
        args,
        source,
        authenticated: true,
        models: [],
      }),
    });
    const zipInstall = await goodManaged.ensure();
    expect(zipInstall).toMatchObject({ version: '1.5.10', source: 'managed', authenticated: true });
  });

  test('runs live ACP initialize + session/new probe against scripted binary', async () => {
    const dir = tempDir('ag-live-');
    const home = join(dir, 'home');
    const binDir = join(home, '.local', 'bin');
    mkdirSync(binDir, { recursive: true });
    const fakeAgy = join(binDir, 'agy');
    writeFileSync(
      fakeAgy,
      [
        `#!${process.execPath}`,
        "import { createInterface } from 'node:readline';",
        'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
        'for await (const line of createInterface({ input: process.stdin })) {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentInfo: { name: "agy", version: "1.5.10" }, agentCapabilities: {} } });',
        '  } else if (msg.method === "session/new") {',
        '    send({ id: msg.id, result: { sessionId: "probe-1", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-carbon", options: [{ value: "gemini-4-carbon", name: "Gemini 4 Carbon" }] }] } });',
        '  }',
        '}',
      ].join('\n'),
    );
    chmodSync(fakeAgy, 0o755);

    const managed = createAntigravityManaged({
      home,
      pathEnv: '',
      platform: 'darwin',
      arch: 'arm64',
    });
    const probed = await managed.probe();
    expect(probed).toMatchObject({
      binPath: fakeAgy,
      source: 'local',
      version: '1.5.10',
      authenticated: true,
      models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
    });
  });
});
