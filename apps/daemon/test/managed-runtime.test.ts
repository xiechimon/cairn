import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionOpts, StepEvent } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createAcpBackend, createGeminiBackend } from '../src/backend/acp.js';
import { createClaudeCodeBackend } from '../src/backend/claude-code.js';
import { createDevinUpdateNormalizer } from '../src/backend/devin-acp.js';
import {
  createClaudeManaged,
  createDevinManaged,
  createGeminiManaged,
} from '../src/backend/runtime-channels.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) releaseTestTempDir(dir);
});

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function makeAcpRuntimeBody(version: string, gateFile?: string): string {
  return [
    "const { existsSync } = require('node:fs');",
    "const { createInterface } = require('node:readline');",
    `const VERSION = ${JSON.stringify(version)};`,
    `const GATE = ${JSON.stringify(gateFile ?? null)};`,
    "if (process.argv.includes('--version')) { console.log('devin ' + VERSION + ' (test)'); process.exit(0); }",
    "const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\\n');",
    "const update = (value) => send({ method: 'session/update', params: { sessionId: 's-1', update: value } });",
    '(async () => {',
    '  for await (const line of createInterface({ input: process.stdin })) {',
    '    const { id, method, params } = JSON.parse(line);',
    "    if (method === 'initialize') {",
    '      send({ id, result: { protocolVersion: params.protocolVersion, agentCapabilities: { loadSession: true }, authMethods: [] } });',
    "    } else if (method === 'session/new') {",
    "      send({ id, result: { sessionId: 's-1', modes: { currentModeId: 'bypass', availableModes: [{ id: 'bypass', name: 'Bypass' }] }, configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'stub-model', options: [{ value: 'stub-model', name: 'Stub' }] }] } });",
    "    } else if (method === 'session/set_config_option' || method === 'session/set_mode') {",
    '      send({ id, result: { configOptions: [] } });',
    "    } else if (method === 'session/prompt') {",
    "      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'started:' + VERSION } });",
    '      if (GATE !== null) {',
    '        while (!existsSync(GATE)) await new Promise((r) => setTimeout(r, 15));',
    '      }',
    "      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ':finished:' + VERSION } });",
    "      send({ id, result: { stopReason: 'end_turn' } });",
    '    }',
    '  }',
    '})();',
  ].join('\n');
}

function makeDevinTarball(dir: string, name: string, scriptBody: string): Buffer {
  const pkg = join(dir, `pkg-${name}`);
  mkdirSync(join(pkg, 'bin'), { recursive: true });
  writeFileSync(join(pkg, 'bin', 'agent.cjs'), scriptBody);
  const quotedNode = JSON.stringify(process.execPath);
  writeFileSync(
    join(pkg, 'bin', 'devin'),
    `#!/bin/sh\nexec ${quotedNode} "$(dirname "$0")/agent.cjs" "$@"\n`,
    { mode: 0o755 },
  );
  const out = join(dir, `${name}.tar.gz`);
  execFileSync('tar', ['-czf', out, '-C', pkg, '.']);
  return readFileSync(out);
}

function makeGeminiTarball(dir: string, name: string, script: string): Buffer {
  const src = join(dir, `gem-${name}`);
  mkdirSync(join(src, 'package', 'bundle'), { recursive: true });
  writeFileSync(join(src, 'package', 'bundle', 'gemini.js'), script);
  const out = join(dir, `${name}.tgz`);
  execFileSync('tar', ['-czf', out, '-C', src, 'package']);
  return readFileSync(out);
}

function makeClaudeScript(version: string): Buffer {
  return Buffer.from(`#!/bin/sh\necho "${version} (Claude Code)"\n`);
}

function makeBrokenScript(): Buffer {
  return Buffer.from('#!/bin/sh\necho "broken binary" >&2\nexit 1\n');
}

describe('shared managed runtime update path', () => {
  test('claude-code checks vendor channel when enabled, installs side-by-side, validates, and switches active version', async () => {
    const dir = tempDir('rt-claude-');
    const root = join(dir, 'tools', 'claude');
    let checksEnabled = false;
    let latestVersion = '2.1.331';
    const binaries: Record<string, Buffer> = {
      '2.1.331': makeClaudeScript('2.1.331'),
      '2.1.332': makeBrokenScript(),
    };
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/latest')) return new Response(`${latestVersion}\n`);
      if (url.endsWith(`/${latestVersion}/manifest.json`)) {
        const bytes = binaries[latestVersion]!;
        return new Response(
          JSON.stringify({
            version: latestVersion,
            platforms: {
              'darwin-arm64': {
                binary: 'claude',
                checksum: sha256(bytes),
                size: bytes.byteLength,
              },
            },
          }),
        );
      }
      const bytes = binaries[latestVersion];
      if (bytes !== undefined && url.endsWith(`/${latestVersion}/darwin-arm64/claude`)) {
        return new Response(new Uint8Array(bytes));
      }
      return new Response('not found', { status: 404 });
    };

    const managed = createClaudeManaged({
      root,
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl,
      updateChecksEnabled: () => checksEnabled,
      resolveSeed: () => ({
        version: '2.1.330',
        command: '/bundled/claude',
        args: [],
        binPath: '/bundled/claude',
        source: 'bundled',
      }),
    });

    expect(managed.current()?.version).toBe('2.1.330');
    expect(managed.current()?.source).toBe('bundled');

    await managed.checkForUpdate({ force: true });
    expect(requests).toHaveLength(0);
    expect(managed.status().availableVersion).toBeNull();

    checksEnabled = true;
    const checked = await managed.checkForUpdate({ force: true });
    expect(checked.installedVersion).toBe('2.1.330');
    expect(checked.availableVersion).toBe('2.1.331');

    const updated = await managed.update();
    expect(updated?.version).toBe('2.1.331');
    expect(updated?.source).toBe('managed');
    expect(managed.current()?.version).toBe('2.1.331');
    expect(managed.status().availableVersion).toBeNull();
    expect(managed.status().phase).toBe('idle');

    latestVersion = '2.1.332';
    const checkedBroken = await managed.checkForUpdate({ force: true });
    expect(checkedBroken.availableVersion).toBe('2.1.332');

    const failed = await managed.update();
    expect(failed).toBeNull();
    expect(managed.current()?.version).toBe('2.1.331');
    expect(managed.status()).toMatchObject({
      installedVersion: '2.1.331',
      availableVersion: '2.1.332',
      phase: 'failed',
    });
    expect(existsSync(join(root, 'versions', '2.1.332'))).toBe(false);
    expect(existsSync(join(root, 'versions', '2.1.331', 'claude'))).toBe(true);
  });

  test('claude-code override disables managed update checks and updates', async () => {
    const dir = tempDir('rt-claude-override-');
    let fetchCalls = 0;
    const managed = createClaudeManaged({
      root: join(dir, 'tools', 'claude'),
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response('2.1.999');
      },
      resolveSeed: () => ({
        version: '2.1.300',
        command: '/custom/claude',
        args: [],
        binPath: '/custom/claude',
        source: 'override',
      }),
    });

    expect(managed.current()?.source).toBe('override');
    expect((await managed.checkForUpdate({ force: true })).availableVersion).toBeNull();
    expect((await managed.update())?.binPath).toBe('/custom/claude');
    expect(fetchCalls).toBe(0);
  });

  test('gemini channel updates side-by-side, keeps old version on validation failure, and next session uses new version', async () => {
    const dir = tempDir('rt-gemini-');
    const root = join(dir, 'tools', 'gemini');
    const v1 = makeGeminiTarball(dir, 'v1', makeAcpRuntimeBody('0.70.0'));
    const v2 = makeGeminiTarball(dir, 'v2', makeAcpRuntimeBody('0.71.0'));
    const bad = makeGeminiTarball(dir, 'bad', 'process.exit(1);\n');
    let activeVersion = '0.70.0';
    const tarballs: Record<string, Buffer> = { '0.70.0': v1, '0.71.0': v2, '0.72.0': bad };

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('registry.json')) {
        return new Response(
          JSON.stringify({
            agents: [
              {
                id: 'gemini',
                distribution: {
                  npx: { package: `@google/gemini-cli@${activeVersion}`, args: ['--acp'] },
                },
              },
            ],
          }),
        );
      }
      if (url.includes('gemini-cli')) {
        const bytes = tarballs[activeVersion]!;
        return new Response(
          JSON.stringify({
            dist: {
              tarball: `https://example.invalid/gemini-${activeVersion}.tgz`,
              shasum: createHash('sha1').update(bytes).digest('hex'),
            },
          }),
        );
      }
      return new Response(new Uint8Array(tarballs[activeVersion]!));
    };

    const managed = createGeminiManaged({
      root,
      nodePath: process.execPath,
      tarballHost: 'example.invalid',
      fetchImpl,
      updateChecksEnabled: () => true,
    });

    expect((await managed.ensure())?.version).toBe('0.70.0');

    const backend = createGeminiBackend({
      resolveLaunch: () => {
        const lease = managed.acquire();
        return lease === null
          ? null
          : { command: lease.command, args: lease.args, release: lease.release };
      },
    });
    const sessionOpts: SessionOpts = {
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'gemini' },
      modelId: 'stub-model',
      prompt: 'Hello',
    };
    const runText = async () => {
      const session = await backend.createSession(sessionOpts);
      let text = '';
      for await (const ev of session.events) {
        if (ev.type === 'text_delta') text += ev.text;
      }
      return text;
    };

    expect(await runText()).toBe('started:0.70.0:finished:0.70.0');

    activeVersion = '0.72.0';
    expect(await managed.update()).toBeNull();
    expect(managed.current()?.version).toBe('0.70.0');
    expect(await runText()).toBe('started:0.70.0:finished:0.70.0');

    activeVersion = '0.71.0';
    expect((await managed.checkForUpdate({ force: true })).availableVersion).toBe('0.71.0');
    expect((await managed.update())?.version).toBe('0.71.0');
    expect(await runText()).toBe('started:0.71.0:finished:0.71.0');
  });

  test('running session finishes uninterrupted on old version while concurrent new session uses updated version', async () => {
    const dir = tempDir('rt-live-swap-');
    const root = join(dir, 'tools', 'devin');
    const gateFile = join(dir, 'release-session-1');
    const v1Tar = makeDevinTarball(dir, 'v1', makeAcpRuntimeBody('3000.0.1', gateFile));
    const v2Tar = makeDevinTarball(dir, 'v2', makeAcpRuntimeBody('3000.0.2'));
    let activeVersion = '3000.0.1';
    const tarballs: Record<string, Buffer> = { '3000.0.1': v1Tar, '3000.0.2': v2Tar };

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      const bytes = tarballs[activeVersion]!;
      if (url.includes('manifest.json')) {
        return new Response(
          JSON.stringify({
            version: activeVersion,
            platforms: {
              'aarch64-apple-darwin': {
                url: `https://x/devin-${activeVersion}.tar.gz`,
                sha256: sha256(bytes),
              },
              'x86_64-apple-darwin': {
                url: `https://x/devin-${activeVersion}.tar.gz`,
                sha256: sha256(bytes),
              },
              'aarch64-unknown-linux': {
                url: `https://x/devin-${activeVersion}.tar.gz`,
                sha256: sha256(bytes),
              },
              'x86_64-unknown-linux': {
                url: `https://x/devin-${activeVersion}.tar.gz`,
                sha256: sha256(bytes),
              },
            },
          }),
        );
      }
      return new Response(new Uint8Array(bytes));
    };

    const managed = createDevinManaged({
      root,
      home: join(dir, 'devin-home'),
      archiveHost: 'x',
      fetchImpl,
      updateChecksEnabled: () => true,
    });
    expect((await managed.ensure())?.version).toBe('3000.0.1');

    const backend = createAcpBackend({
      harness: 'devin',
      command: 'unused',
      args: [],
      resolveLaunch: () => {
        const lease = managed.acquire();
        return lease === null
          ? null
          : { command: lease.command, args: lease.args, release: lease.release };
      },
      permissions: 'allow-once',
      allowHostMcp: true,
      createUpdateNormalizer: createDevinUpdateNormalizer,
    });
    const sessionOpts: SessionOpts = {
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'devin' },
      modelId: 'stub-model',
      prompt: 'Hello',
    };

    const session1 = await backend.createSession(sessionOpts);
    const s1Events: StepEvent[] = [];
    let s1Started = false;
    const s1Done = (async () => {
      for await (const ev of session1.events) {
        s1Events.push(ev);
        if (ev.type === 'text_delta' && ev.text.includes('started:3000.0.1')) {
          s1Started = true;
        }
      }
    })();
    await waitFor(() => s1Started);

    activeVersion = '3000.0.2';
    expect((await managed.checkForUpdate({ force: true })).availableVersion).toBe('3000.0.2');
    expect((await managed.update())?.version).toBe('3000.0.2');

    expect(existsSync(join(root, 'versions', '3000.0.1', 'bin', 'devin'))).toBe(true);
    expect(existsSync(join(root, 'versions', '3000.0.2', 'bin', 'devin'))).toBe(true);

    const session2 = await backend.createSession(sessionOpts);
    let s2Text = '';
    for await (const ev of session2.events) {
      if (ev.type === 'text_delta') s2Text += ev.text;
    }
    expect(s2Text).toBe('started:3000.0.2:finished:3000.0.2');

    writeFileSync(gateFile, 'go');
    await s1Done;
    const s1Text = s1Events
      .filter((ev): ev is Extract<StepEvent, { type: 'text_delta' }> => ev.type === 'text_delta')
      .map((ev) => ev.text)
      .join('');
    expect(s1Text).toBe('started:3000.0.1:finished:3000.0.1');
    expect(s1Events.some((ev) => ev.type === 'done')).toBe(true);

    await waitFor(() => !existsSync(join(root, 'versions', '3000.0.1')));
    expect(existsSync(join(root, 'versions', '3000.0.2', 'bin', 'devin'))).toBe(true);
  });

  test('machine-loop checks channel updates on startup, updates on SSE runtime.update, and switches next step', async () => {
    const dir = tempDir('rt-loop-');
    const tarDir = tempDir('rt-loop-tar-');
    const root = join(dir, 'tools', 'devin');
    const v1Tar = makeDevinTarball(tarDir, 'v1', makeAcpRuntimeBody('3000.0.1'));
    const v2Tar = makeDevinTarball(tarDir, 'v2', makeAcpRuntimeBody('3000.0.2'));
    let activeVersion = '3000.0.1';
    const tarballs: Record<string, Buffer> = { '3000.0.1': v1Tar, '3000.0.2': v2Tar };

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      const bytes = tarballs[activeVersion]!;
      if (url.includes('manifest.json')) {
        return new Response(
          JSON.stringify({
            version: activeVersion,
            platforms: {
              'aarch64-apple-darwin': {
                url: `https://x/devin-${activeVersion}.tar.gz`,
                sha256: sha256(bytes),
              },
              'x86_64-apple-darwin': {
                url: `https://x/devin-${activeVersion}.tar.gz`,
                sha256: sha256(bytes),
              },
              'aarch64-unknown-linux': {
                url: `https://x/devin-${activeVersion}.tar.gz`,
                sha256: sha256(bytes),
              },
              'x86_64-unknown-linux': {
                url: `https://x/devin-${activeVersion}.tar.gz`,
                sha256: sha256(bytes),
              },
            },
          }),
        );
      }
      return new Response(new Uint8Array(bytes));
    };

    const devinManaged = createDevinManaged({
      root,
      home: join(root, 'home'),
      archiveHost: 'x',
      fetchImpl,
      updateChecksEnabled: () => true,
      checkIntervalMs: 0,
    });
    expect((await devinManaged.ensure())?.version).toBe('3000.0.1');
    activeVersion = '3000.0.2';

    const api = new FakeMachineApi();
    api.devinToken = 'wsk-test';
    const { handle } = await boot({
      home: dir,
      api,
      presenceIntervalMs: 40,
      devinManaged,
      updateChecksEnabled: () => true,
    });

    await waitFor(() =>
      api.presenceBodies.some(
        (body) =>
          (
            body as {
              capabilities?: { devin?: { update?: { availableVersion?: string | null } } };
            }
          ).capabilities?.devin?.update?.availableVersion === '3000.0.2',
      ),
    );

    await waitFor(() => api.onStreamEvent !== null);
    api.onStreamEvent?.({ type: 'runtime.update', runtime: 'devin' });

    await waitFor(() =>
      api.presenceBodies.some(
        (body) =>
          (body as { capabilities?: { devin?: { version?: string } } }).capabilities?.devin
            ?.version === '3000.0.2',
      ),
    );

    await waitFor(() => api.parked !== null);
    api.parked?.({
      ...CLAIMED,
      step: { ...CLAIMED.step, id: 's-updated', kind: 'build' },
      instruction: 'Hello',
      agent: { ...CLAIMED.agent!, provider: 'devin' },
    });
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    const transcript = JSON.stringify(api.uploads);
    expect(transcript).toContain('started:3000.0.2:finished:3000.0.2');

    await handle.stop();
    await handle.done;
  });

  test('claude-code backend resolves active executable per session and releases lease on error', async () => {
    const resolved: string[] = [];
    let released = 0;
    let active = { path: '/nonexistent/v1/claude', version: '2.1.330' };
    const backend = createClaudeCodeBackend({
      resolveExecutable: () => {
        resolved.push(active.path);
        return {
          ...active,
          release: () => {
            released += 1;
          },
        };
      },
    });
    const opts: SessionOpts = {
      cwd: process.cwd(),
      provider: { kind: 'api_key', providerId: 'claude-code' },
      modelId: 'claude-sonnet-5-5',
      prompt: 'Hello',
      remoteTools: [{ name: 'bad', description: 'bad', parameters: { type: 'object' } }],
    };
    await expect(backend.createSession(opts)).rejects.toThrow(/executeRemoteTool/);
    active = { path: '/nonexistent/v2/claude', version: '2.1.331' };
    await expect(backend.createSession(opts)).rejects.toThrow(/executeRemoteTool/);
    expect(resolved).toEqual(['/nonexistent/v1/claude', '/nonexistent/v2/claude']);
    expect(released).toBe(2);
  });

  test('backends fail closed when dynamic resolver returns null instead of using a stale path', async () => {
    const acp = createAcpBackend({
      harness: 'devin',
      command: '/stale/devin',
      args: ['acp'],
      resolveLaunch: () => null,
    });
    await expect(
      acp.createSession({
        cwd: process.cwd(),
        provider: { kind: 'api_key', providerId: 'devin' },
        modelId: 'stub-model',
        prompt: 'Hello',
      }),
    ).rejects.toThrow(/unavailable or failed integrity verification/);

    const claude = createClaudeCodeBackend({
      executablePath: '/stale/claude',
      resolveExecutable: () => null,
    });
    await expect(
      claude.createSession({
        cwd: process.cwd(),
        provider: { kind: 'api_key', providerId: 'claude-code' },
        modelId: 'claude-sonnet-5-5',
        prompt: 'Hello',
      }),
    ).rejects.toThrow(/unavailable or failed integrity verification/);
  });

  test('channel fetch rejects redirects to http or untrusted hosts', async () => {
    const dir = tempDir('rt-redirect-');
    const managed = createClaudeManaged({
      root: join(dir, 'tools', 'claude'),
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://evil.example/latest' },
        }),
    });
    expect(await managed.ensure()).toBeNull();
    expect((await managed.checkForUpdate({ force: true })).availableVersion).toBeNull();
  });
});
