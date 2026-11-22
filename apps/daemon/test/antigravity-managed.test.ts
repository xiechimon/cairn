import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

function writeManagedInstall(root: string, binPath: string): void {
  const versionDir = join(root, 'versions', '1.5.10');
  mkdirSync(versionDir, { recursive: true });
  const binRelPath = 'bin/antigravity-acp';
  mkdirSync(join(versionDir, 'bin'), { recursive: true });
  const bin = join(versionDir, binRelPath);
  const body = readFileSync(binPath);
  writeFileSync(bin, body);
  chmodSync(bin, 0o755);
  writeFileSync(
    join(versionDir, '.install-complete'),
    JSON.stringify({
      version: '1.5.10',
      url: 'https://example.invalid/ag.tar.gz',
      archiveSha256: '0'.repeat(64),
      binRelPath,
      binSha256: createHash('sha256').update(body).digest('hex'),
      args: ['acp'],
      installedAt: Date.now(),
    }),
  );
  writeFileSync(join(root, 'current.json'), JSON.stringify({ version: '1.5.10' }));
}

describe('antigravity managed binary resolution', () => {
  test('ignores a local agy binary on ~/.local/bin — managed copy or nothing', async () => {
    const dir = tempDir('ag-local-');
    const home = join(dir, 'home');
    const binDir = join(home, '.local', 'bin');
    mkdirSync(binDir, { recursive: true });
    const agy = join(binDir, 'agy');
    writeFileSync(agy, '#!/bin/sh\nexit 0\n');
    chmodSync(agy, 0o755);

    const fetched: string[] = [];
    const managed = createAntigravityManaged({
      root: join(dir, 'managed'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async (url) => {
        fetched.push(String(url));
        return new Response('{}', { status: 500 });
      },
    });

    expect(managed.current()).toBeNull();
    expect(await managed.ensure()).toBeNull();
    expect(fetched).toHaveLength(1);
  });

  test('downloads .tar.gz from ACP registry with sha256 verification', async () => {
    const dir = tempDir('ag-reg-');
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
      root: join(dir, 'managed'),
      platform: 'darwin',
      arch: 'arm64',
      registryUrl: 'https://example.invalid/registry.json',
      archiveHost: 'example.invalid',
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
      args: [],
      source: 'managed',
      authenticated: false,
    });
  });

  test('a cached install is dropped once its binary disappears from disk', async () => {
    const dir = tempDir('ag-stale-');
    const root = join(dir, 'managed');
    const src = join(dir, 'antigravity-acp');
    writeFileSync(src, '#!/bin/sh\nexit 0\n');
    writeManagedInstall(root, src);
    const bin = join(root, 'versions', '1.5.10', 'bin', 'antigravity-acp');

    const managed = createAntigravityManaged({
      root,
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async () => new Response('{}', { status: 500 }),
      probeBinary: async (binPath, args, source) => ({
        version: '1.5.10',
        binPath,
        args,
        source,
        authenticated: true,
        models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
      }),
    });

    expect((await managed.probe())?.binPath).toBe(bin);
    rmSync(bin, { force: true });
    expect(managed.current()).toBeNull();
  });

  test('downloads .zip from ACP registry and rejects checksum mismatches', async () => {
    const dir = tempDir('ag-zip-');
    const src = join(dir, 'src');
    mkdirSync(join(src, 'bin'), { recursive: true });
    writeFileSync(join(src, 'bin', 'antigravity-acp'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(src, 'bin', 'antigravity-acp'), 0o755);
    const zipPath = join(dir, 'ag.zip');
    execFileSync('zip', ['-q', '-r', zipPath, 'bin'], { cwd: src });
    const zipBytes = readFileSync(zipPath);
    const validSha = createHash('sha256').update(zipBytes).digest('hex');

    const badManaged = createAntigravityManaged({
      root: join(dir, 'bad-managed'),
      platform: 'darwin',
      arch: 'arm64',
      registryUrl: 'https://example.invalid/registry.json',
      archiveHost: 'example.invalid',
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
      root: join(dir, 'good-managed'),
      platform: 'darwin',
      arch: 'arm64',
      registryUrl: 'https://example.invalid/registry.json',
      archiveHost: 'example.invalid',
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

  test('runs live ACP initialize + session/new probe against a managed install', async () => {
    const dir = tempDir('ag-live-');
    const fakeAgy = join(dir, 'agy-src');
    writeFileSync(
      fakeAgy,
      [
        `#!${process.execPath}`,
        "import { createInterface } from 'node:readline';",
        'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
        'const selected = [];',
        'for await (const line of createInterface({ input: process.stdin })) {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentInfo: { name: "agy", version: "1.5.10" }, agentCapabilities: {} } });',
        '  } else if (msg.method === "session/new") {',
        '    send({ id: msg.id, result: { sessionId: "probe-1", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-carbon", options: [{ value: "gemini-4-carbon", name: "Gemini 4 Carbon" }, { value: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }] }] } });',
        '  } else if (msg.method === "session/set_config_option") {',
        '    selected.push(msg.params.value);',
        '    const thought = msg.params.value === "gemini-4-carbon" ? [{ id: "thought_level", name: "Thinking", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] }] : [];',
        '    send({ id: msg.id, result: { configOptions: thought } });',
        '  }',
        '}',
      ].join('\n'),
    );
    chmodSync(fakeAgy, 0o755);

    const root = join(dir, 'managed');
    writeManagedInstall(root, fakeAgy);
    const managed = createAntigravityManaged({
      root,
      platform: 'darwin',
      arch: 'arm64',
    });
    const probed = await managed.probe();
    expect(probed).toMatchObject({
      source: 'managed',
      version: '1.5.10',
      authenticated: true,
      models: [
        {
          id: 'gemini-4-carbon',
          name: 'Gemini 4 Carbon',
          thinkingLevels: ['low', 'high'],
          thinkingDefault: 'high',
        },
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', thinkingLevels: [] },
      ],
    });
  });

  test('rejects a registry archive hosted off the trusted host or missing sha256', async () => {
    const dir = tempDir('ag-untrusted-');
    for (const entry of [
      {
        name: 'off-host archive',
        binary: {
          archive: 'https://evil.example/ag.tar.gz',
          cmd: './bin/antigravity-acp',
          args: ['acp'],
          sha256: 'a'.repeat(64),
        },
      },
      {
        name: 'missing sha256',
        binary: {
          archive: 'https://example.invalid/ag.tar.gz',
          cmd: './bin/antigravity-acp',
          args: ['acp'],
        },
      },
      {
        name: 'http archive on the trusted host',
        binary: {
          archive: 'http://example.invalid/ag.tar.gz',
          cmd: './bin/antigravity-acp',
          args: ['acp'],
          sha256: 'a'.repeat(64),
        },
      },
    ]) {
      const downloaded: string[] = [];
      const managed = createAntigravityManaged({
        root: join(dir, `managed-${entry.name.replaceAll(' ', '-')}`),
        platform: 'darwin',
        arch: 'arm64',
        registryUrl: 'https://example.invalid/registry.json',
        archiveHost: 'example.invalid',
        fetchImpl: async (url) => {
          const u = String(url);
          if (u.endsWith('registry.json')) {
            return new Response(
              JSON.stringify({
                agents: [
                  {
                    id: 'antigravity-acp',
                    version: '1.5.10',
                    distribution: { binary: { 'darwin-aarch64': entry.binary } },
                  },
                ],
              }),
              { status: 200 },
            );
          }
          downloaded.push(u);
          return new Response('x', { status: 200 });
        },
      });
      expect(await managed.ensure(), entry.name).toBeNull();
      expect(downloaded, entry.name).toEqual([]);
    }
  });

  test('installs even when an unrelated registry entry lacks sha256', async () => {
    const dir = tempDir('ag-mixed-');
    const src = join(dir, 'src');
    mkdirSync(join(src, 'bin'), { recursive: true });
    writeFileSync(join(src, 'bin', 'antigravity-acp'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(src, 'bin', 'antigravity-acp'), 0o755);
    const zipPath = join(dir, 'ag.zip');
    execFileSync('zip', ['-q', '-r', zipPath, 'bin'], { cwd: src });
    const zipBytes = readFileSync(zipPath);
    const validSha = createHash('sha256').update(zipBytes).digest('hex');

    const managed = createAntigravityManaged({
      root: join(dir, 'managed'),
      platform: 'darwin',
      arch: 'arm64',
      registryUrl: 'https://example.invalid/registry.json',
      archiveHost: 'example.invalid',
      fetchImpl: async (url) =>
        String(url).endsWith('registry.json')
          ? new Response(
              JSON.stringify({
                agents: [
                  {
                    id: 'cursor',
                    version: '1.0.0',
                    distribution: {
                      binary: {
                        'darwin-aarch64': {
                          archive: 'https://example.invalid/cursor.zip',
                          cmd: './cursor',
                        },
                      },
                    },
                  },
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
    const install = await managed.ensure();
    expect(install).toMatchObject({ version: '1.5.10', source: 'managed', authenticated: true });
  });

  test('probe does not pass flags the real agy binary rejects', async () => {
    const dir = tempDir('ag-flags-');
    const root = join(dir, 'managed');
    const versionDir = join(root, 'versions', '1.5.10');
    mkdirSync(versionDir, { recursive: true });
    const fakeAgy = join(versionDir, 'agy_acp_server.mjs');
    writeFileSync(
      fakeAgy,
      [
        `#!${process.execPath}`,
        "import { createInterface } from 'node:readline';",
        'const unknown = process.argv.slice(2);',
        'if (unknown.length > 0) {',
        '  process.stderr.write(`FATAL Flags parsing error: Unknown command line argument ${unknown[0]}\\n`);',
        '  process.exit(2);',
        '}',
        'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
        'for await (const line of createInterface({ input: process.stdin })) {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentInfo: { name: "agy", version: "1.5.10" }, agentCapabilities: {} } });',
        '  } else if (msg.method === "session/new") {',
        '    send({ id: msg.id, result: { sessionId: "probe-1", configOptions: [] } });',
        '  }',
        '}',
      ].join('\n'),
    );
    chmodSync(fakeAgy, 0o755);
    writeFileSync(
      join(versionDir, '.install-complete'),
      JSON.stringify({
        version: '1.5.10',
        url: 'https://example.invalid/ag.zip',
        archiveSha256: '0'.repeat(64),
        binRelPath: 'agy_acp_server.mjs',
        binSha256: createHash('sha256').update(readFileSync(fakeAgy)).digest('hex'),
        args: ['acp'],
        installedAt: Date.now(),
      }),
    );
    writeFileSync(join(root, 'current.json'), JSON.stringify({ version: '1.5.10' }));
    const managed = createAntigravityManaged({ root, platform: 'darwin', arch: 'arm64' });
    const probed = await managed.probe();
    expect(probed).toMatchObject({ source: 'managed', args: [], authenticated: true });
  });

  test('rejects an archive whose binary escapes through a symlinked directory', async () => {
    const dir = tempDir('ag-escape-');
    const outside = join(dir, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'antigravity-acp'), '#!/bin/sh\nexit 0\n');
    const src = join(dir, 'src');
    mkdirSync(src);
    symlinkSync(outside, join(src, 'bin'));
    const archivePath = join(dir, 'ag.tar.gz');
    execFileSync('tar', ['-czf', archivePath, '-C', src, '.']);
    const archiveBytes = readFileSync(archivePath);
    const archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex');
    const managed = createAntigravityManaged({
      root: join(dir, 'managed'),
      platform: 'darwin',
      arch: 'arm64',
      registryUrl: 'https://example.invalid/registry.json',
      archiveHost: 'example.invalid',
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
    });
    expect(await managed.ensure()).toBeNull();
  });
});
