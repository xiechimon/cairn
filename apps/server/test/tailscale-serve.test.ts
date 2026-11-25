import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PairResponse, TailscaleAccess } from '@cairn/shared';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { tailscaleSocketCandidates } from '../src/lib/tailscale-socket.js';
import {
  createTailscaleServe,
  type RunResult,
  type RunTailscale,
  tailscaleCliCandidates,
} from '../src/services/tailscale-serve.js';
import { bootServer, redeemTestPairing, type TestServer } from './helpers.js';

const OWNER = 'tailscale-serve-owner-token-0123456789abcdef';
const ENVIRONMENT_ID = '0f9d3a52-6c1e-4b7a-9d3e-5a1c2b4d6e80';
const DNS = 'studio-mac.tail4c2a.ts.net';
const PORT = 51234;
const ownerHeaders = { authorization: `Bearer ${OWNER}` };
const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) releaseTestTempDir(dir);
});

function recordPath(): string {
  const dir = makeTestTempDir('ts-serve-');
  tmpDirs.push(dir);
  return join(dir, 'tailscale-serve.json');
}

type Web = Record<string, { Handlers: Record<string, { Proxy: string }> }>;

interface FakeNode {
  backend: string;
  web: Web;
  tcp: Record<string, { HTTPS: boolean }>;
  serveCalls: string[][];
  onServe?: (args: readonly string[], onOutput?: (output: string) => void) => Promise<RunResult>;
}

function fakeNode(proxies: Record<number, string> = {}, backend = 'Running'): FakeNode {
  const node: FakeNode = { backend, web: {}, tcp: {}, serveCalls: [] };
  for (const [port, proxy] of Object.entries(proxies)) {
    node.web[`${DNS}:${port}`] = { Handlers: { '/': { Proxy: proxy } } };
    node.tcp[port] = { HTTPS: true };
  }
  return node;
}

function applyServe(node: FakeNode, args: readonly string[]): void {
  const port = args.find((arg) => arg.startsWith('--https='))?.slice('--https='.length) ?? '443';
  const target = args[args.length - 1] ?? '';
  if (target === 'off') {
    delete node.web[`${DNS}:${port}`];
    delete node.tcp[port];
    return;
  }
  node.web[`${DNS}:${port}`] = { Handlers: { '/': { Proxy: target } } };
  node.tcp[port] = { HTTPS: true };
}

function runOn(node: FakeNode): RunTailscale {
  return async (_bin, args, options) => {
    if (args[0] === 'status') {
      return {
        code: 0,
        stdout: JSON.stringify({ BackendState: node.backend, Self: { DNSName: `${DNS}.` } }),
        stderr: '',
      };
    }
    if (args[0] === 'serve' && args[1] === 'status') {
      const empty = Object.keys(node.web).length === 0 && Object.keys(node.tcp).length === 0;
      return {
        code: 0,
        stdout: empty ? '{}' : JSON.stringify({ TCP: node.tcp, Web: node.web }),
        stderr: '',
      };
    }
    node.serveCalls.push([...args]);
    if (node.onServe !== undefined) return node.onServe(args, options.onOutput);
    applyServe(node, args);
    return { code: 0, stdout: '', stderr: '' };
  };
}

function descriptorFetch(environmentId: string, seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    seen.push(String(input));
    return new Response(JSON.stringify({ environmentId, version: 1 }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function serveFor(
  node: FakeNode,
  options: { fetch?: typeof fetch; now?: () => number; record?: string; cli?: string | null } = {},
) {
  return createTailscaleServe({
    environmentId: ENVIRONMENT_ID,
    listenPort: PORT,
    recordPath: options.record ?? recordPath(),
    findCli: () => (options.cli === undefined ? '/usr/bin/tailscale' : options.cli),
    run: runOn(node),
    fetch: options.fetch ?? descriptorFetch(ENVIRONMENT_ID),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}

function call(s: TestServer, method: string, path: string, headers: Record<string, string> = {}) {
  return Promise.resolve(
    s.app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(method === 'GET' ? {} : { body: '{}' }),
    }),
  );
}

describe('the Tailscale address a Runner uses to reach this server', () => {
  test('enabling serves this server on the first free HTTPS port and never replaces another service', async () => {
    const node = fakeNode({ 443: 'http://127.0.0.1:3000' });
    const seen: string[] = [];
    const serve = serveFor(node, { fetch: descriptorFetch(ENVIRONMENT_ID, seen) });

    expect(await serve.status()).toMatchObject({ state: 'off', url: null });
    const enabled = await serve.enable();

    expect(node.serveCalls).toEqual([
      ['serve', '--bg', '--https=8443', `http://127.0.0.1:${PORT}`],
    ]);
    expect(node.web[`${DNS}:443`]?.Handlers['/']?.Proxy).toBe('http://127.0.0.1:3000');
    expect(enabled).toEqual({ state: 'ready', url: `https://${DNS}:8443`, consentUrl: null });
    expect(seen).toEqual([`https://${DNS}:8443/api/remote/descriptor`]);
  });

  test('an address that answers for a different Cairn server is not ready', async () => {
    let clock = 1_000;
    const node = fakeNode({ 443: `http://127.0.0.1:${PORT}` });
    const serve = serveFor(node, {
      fetch: descriptorFetch('11111111-2222-4333-8444-555555555555'),
      now: () => clock,
    });
    expect(await serve.status()).toMatchObject({ state: 'verifying', url: `https://${DNS}` });
    clock += 91_000;
    expect(await serve.status()).toMatchObject({ state: 'unreachable', url: `https://${DNS}` });
  });

  test('the address Serve prints on success is not mistaken for an HTTPS consent link', async () => {
    const node = fakeNode();
    node.onServe = async (args, onOutput) => {
      onOutput?.(
        `Available within your tailnet:\n\nhttps://${DNS}/\n|-- proxy http://127.0.0.1:${PORT}\n\nServe started and running in the background.\n`,
      );
      applyServe(node, args);
      return { code: 0, stdout: '', stderr: '' };
    };
    expect(await serveFor(node).enable()).toEqual({
      state: 'ready',
      url: `https://${DNS}`,
      consentUrl: null,
    });
  });

  test('a mapping made by hand to this server is found without changing anything', async () => {
    const node = fakeNode({ 443: `http://localhost:${PORT}` });
    const serve = serveFor(node);
    expect(await serve.enable()).toEqual({
      state: 'ready',
      url: `https://${DNS}`,
      consentUrl: null,
    });
    expect(node.serveCalls).toEqual([]);
  });

  test('every Serve port taken by other services is reported, not overwritten', async () => {
    const node = fakeNode({
      443: 'http://127.0.0.1:3000',
      8443: 'http://127.0.0.1:3001',
      10000: 'http://127.0.0.1:3002',
    });
    const serve = serveFor(node);
    expect((await serve.status()).state).toBe('occupied');
    expect((await serve.enable()).state).toBe('occupied');
    expect(node.serveCalls).toEqual([]);
  });

  test('no CLI, a signed-out node and a refused write each name the step to take', async () => {
    expect((await serveFor(fakeNode(), { cli: null }).status()).state).toBe('not-installed');
    expect((await serveFor(fakeNode({}, 'NeedsLogin')).status()).state).toBe('not-connected');

    const refusing = fakeNode();
    refusing.onServe = async () => ({
      code: 1,
      stdout: '',
      stderr:
        "Access denied: serve config denied\n\nUse 'sudo tailscale serve'.\nTo not require root, use 'sudo tailscale set --operator=$USER' once.",
    });
    const serve = serveFor(refusing);
    expect((await serve.enable()).state).toBe('needs-operator');
    expect((await serve.status()).state).toBe('needs-operator');
  });

  test('a tailnet without HTTPS returns the consent link while the CLI waits, then turns ready', async () => {
    const node = fakeNode();
    let finish: () => void = () => {};
    node.onServe = (args, onOutput) => {
      onOutput?.(
        '\nServe is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=nXyZ\n\n',
      );
      return new Promise((resolve) => {
        finish = () => {
          applyServe(node, args);
          resolve({ code: 0, stdout: '', stderr: '' });
        };
      });
    };
    const serve = serveFor(node);
    expect(await serve.enable()).toEqual({
      state: 'needs-https',
      url: null,
      consentUrl: 'https://login.tailscale.com/f/serve?node=nXyZ',
    });
    expect((await serve.status()).state).toBe('needs-https');
    finish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await serve.status()).toMatchObject({ state: 'ready', url: `https://${DNS}` });
  });

  test('after a restart on a new port the earlier mapping is moved, a foreign one is left alone', async () => {
    const record = recordPath();
    writeFileSync(record, JSON.stringify({ httpsPort: 443, target: 'http://127.0.0.1:40000' }));
    const moved = fakeNode({ 443: 'http://127.0.0.1:40000' });
    await serveFor(moved, { record }).reapply();
    expect(moved.serveCalls).toEqual([
      ['serve', '--bg', '--https=443', `http://127.0.0.1:${PORT}`],
    ]);
    expect(JSON.parse(readFileSync(record, 'utf8'))).toEqual({
      httpsPort: 443,
      target: `http://127.0.0.1:${PORT}`,
    });

    const foreign = fakeNode({ 443: 'http://127.0.0.1:3000' });
    await serveFor(foreign, { record }).reapply();
    expect(foreign.serveCalls).toEqual([
      ['serve', '--bg', '--https=8443', `http://127.0.0.1:${PORT}`],
    ]);
    expect(foreign.web[`${DNS}:443`]?.Handlers['/']?.Proxy).toBe('http://127.0.0.1:3000');
  });

  test('an old target reused by another service on another port is not taken as ours', async () => {
    const record = recordPath();
    writeFileSync(record, JSON.stringify({ httpsPort: 443, target: 'http://127.0.0.1:40000' }));
    const node = fakeNode({ 443: 'http://127.0.0.1:3000', 8443: 'http://127.0.0.1:40000' });
    await serveFor(node, { record }).reapply();
    expect(node.serveCalls).toEqual([
      ['serve', '--bg', '--https=10000', `http://127.0.0.1:${PORT}`],
    ]);
    expect(node.web[`${DNS}:8443`]?.Handlers['/']?.Proxy).toBe('http://127.0.0.1:40000');
  });

  test('withdrawing removes only the mapping this server made', async () => {
    const record = recordPath();
    const node = fakeNode({ 443: 'http://127.0.0.1:3000' });
    const serve = serveFor(node, { record });
    await serve.enable();
    await serve.withdraw();
    expect(node.serveCalls.at(-1)).toEqual(['serve', '--https=8443', 'off']);
    expect(node.web[`${DNS}:8443`]).toBeUndefined();
    expect(node.web[`${DNS}:443`]?.Handlers['/']?.Proxy).toBe('http://127.0.0.1:3000');

    const handMade = fakeNode({ 443: `http://127.0.0.1:${PORT}` });
    await serveFor(handMade).withdraw();
    expect(handMade.serveCalls).toEqual([]);
  });

  test('without an earlier opt-in, starting up does not touch Tailscale', async () => {
    const node = fakeNode();
    await serveFor(node).reapply();
    expect(node.serveCalls).toEqual([]);
  });

  test('the CLI is looked up where each installer puts it, not only on PATH', () => {
    expect(tailscaleCliCandidates('darwin', { PATH: '/usr/bin:/bin' })).toContain(
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    );
    expect(tailscaleCliCandidates('win32', { PATH: '', ProgramFiles: 'D:\\Apps' })).toEqual([
      'D:\\Apps\\Tailscale\\tailscale.exe',
    ]);
  });

  test('falls back to a later working CLI candidate when an earlier binary on PATH cannot reach a daemon', async () => {
    const dir = makeTestTempDir('ts-multi-cli-');
    tmpDirs.push(dir);
    const brokenDir = join(dir, 'broken');
    const workingDir = join(dir, 'working');
    mkdirSync(brokenDir, { recursive: true });
    mkdirSync(workingDir, { recursive: true });
    const brokenBin = join(brokenDir, 'tailscale');
    const workingBin = join(workingDir, 'tailscale');
    writeFileSync(brokenBin, '#!/bin/sh\nexit 1\n');
    writeFileSync(workingBin, '#!/bin/sh\nexit 0\n');
    chmodSync(brokenBin, 0o755);
    chmodSync(workingBin, 0o755);
    vi.stubEnv('PATH', `${brokenDir}:${workingDir}`);

    const node = fakeNode();
    const runner = runOn(node);
    const serve = createTailscaleServe({
      environmentId: ENVIRONMENT_ID,
      listenPort: PORT,
      recordPath: recordPath(),
      fetch: descriptorFetch(ENVIRONMENT_ID),
      run: async (bin, args, opts) => {
        if (bin === brokenBin) {
          return {
            code: 1,
            stdout: '',
            stderr: 'dial unix /var/run/tailscaled.socket: connect: no such file or directory',
          };
        }
        return runner(bin, args, opts);
      },
    });
    try {
      expect(await serve.status()).toMatchObject({ state: 'off', url: null });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test('reports needs-operator instead of not-connected when serve status denies access on a running node', async () => {
    const node = fakeNode();
    const baseRun = runOn(node);
    const serve = createTailscaleServe({
      environmentId: ENVIRONMENT_ID,
      listenPort: PORT,
      recordPath: recordPath(),
      findCli: () => '/usr/bin/tailscale',
      fetch: descriptorFetch(ENVIRONMENT_ID),
      run: async (bin, args, opts) => {
        if (args[0] === 'serve' && args[1] === 'status') {
          return {
            code: 1,
            stdout: '',
            stderr:
              "Access denied: serve config denied\nTo not require root, use 'sudo tailscale set --operator=$USER' once.",
          };
        }
        return baseRun(bin, args, opts);
      },
    });
    expect(await serve.status()).toMatchObject({ state: 'needs-operator', url: null });
  });

  test('reports needs-https when serve status returns a consent URL on a running node', async () => {
    const node = fakeNode();
    const baseRun = runOn(node);
    const serve = createTailscaleServe({
      environmentId: ENVIRONMENT_ID,
      listenPort: PORT,
      recordPath: recordPath(),
      findCli: () => '/usr/bin/tailscale',
      fetch: descriptorFetch(ENVIRONMENT_ID),
      run: async (bin, args, opts) => {
        if (args[0] === 'serve' && args[1] === 'status') {
          return {
            code: 1,
            stdout: '',
            stderr:
              '\nServe is not enabled on your tailnet.\nTo enable, visit:\n\n https://login.tailscale.com/f/serve?node=nAbc\n',
          };
        }
        return baseRun(bin, args, opts);
      },
    });
    expect(await serve.status()).toEqual({
      state: 'needs-https',
      url: null,
      consentUrl: 'https://login.tailscale.com/f/serve?node=nAbc',
    });
  });

  test('falls back to an active tailscaled socket and carries --socket into status, enable and withdraw', async () => {
    const sock = '/var/run/tailscaled.sock';
    const node = fakeNode();
    const baseRun = runOn(node);
    const calls: string[][] = [];
    const serve = createTailscaleServe({
      environmentId: ENVIRONMENT_ID,
      listenPort: PORT,
      recordPath: recordPath(),
      findCli: () => '/usr/local/bin/tailscale',
      findSockets: () => [sock],
      fetch: descriptorFetch(ENVIRONMENT_ID),
      run: async (bin, args, opts) => {
        calls.push([...args]);
        if (args[0] !== `--socket=${sock}`) {
          return {
            code: 1,
            stdout: '',
            stderr:
              'failed to connect to local tailscaled (which appears to be running as tailscaled, pid 310). Got error: dial unix /var/run/tailscaled.socket: connect: no such file or directory',
          };
        }
        return baseRun(bin, args.slice(1), opts);
      },
    });

    expect(await serve.status()).toEqual({ state: 'off', url: null, consentUrl: null });
    expect(await serve.enable()).toEqual({
      state: 'ready',
      url: `https://${DNS}`,
      consentUrl: null,
    });
    await serve.withdraw();

    expect(node.serveCalls).toEqual([
      ['serve', '--bg', '--https=443', `http://127.0.0.1:${PORT}`],
      ['serve', '--https=443', 'off'],
    ]);
    expect(
      calls.filter((args) => args[0] === `--socket=${sock}` && args[1] === 'serve').length,
    ).toBeGreaterThanOrEqual(4);
    expect(tailscaleSocketCandidates('darwin')).toContain(sock);
  });

  test('skips non-executable files on PATH when locating the Tailscale CLI', async () => {
    const dir = makeTestTempDir('ts-nonexec-');
    tmpDirs.push(dir);
    const badDir = join(dir, 'bad');
    const goodDir = join(dir, 'good');
    mkdirSync(badDir, { recursive: true });
    mkdirSync(goodDir, { recursive: true });
    const nonExec = join(badDir, 'tailscale');
    const execBin = join(goodDir, 'tailscale');
    writeFileSync(nonExec, 'not executable');
    chmodSync(nonExec, 0o644);
    writeFileSync(execBin, '#!/bin/sh\nexit 0\n');
    chmodSync(execBin, 0o755);
    vi.stubEnv('PATH', `${badDir}:${goodDir}`);

    const seenBins: string[] = [];
    const runner = runOn(fakeNode());
    const serve = createTailscaleServe({
      environmentId: ENVIRONMENT_ID,
      listenPort: PORT,
      recordPath: recordPath(),
      fetch: descriptorFetch(ENVIRONMENT_ID),
      run: async (bin, args, opts) => {
        seenBins.push(bin);
        return runner(bin, args, opts);
      },
    });
    try {
      expect(await serve.status()).toMatchObject({ state: 'off' });
      expect(seenBins.every((bin) => bin === execBin)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('who may turn Tailscale access on', () => {
  async function pairDevice(s: TestServer): Promise<PairResponse> {
    const issued = await call(s, 'POST', '/api/remote/pairing', ownerHeaders);
    const { code } = (await issued.json()) as { code: string };
    const res = await redeemTestPairing(s.app, code, 'phone');
    return (await res.json()) as PairResponse;
  }

  test('a paired device can read and turn Tailscale access on like the owner session', async () => {
    const node = fakeNode();
    const s = bootServer({ authToken: OWNER, remote: { tailscale: serveFor(node) } });
    const device = await pairDevice(s);
    const deviceHeaders = { authorization: `Bearer ${device.token}` };

    expect((await call(s, 'GET', '/api/remote/tailscale')).status).toBe(401);
    const read = await call(s, 'GET', '/api/remote/tailscale', deviceHeaders);
    expect(((await read.json()) as TailscaleAccess).state).toBe('off');

    const enabled = await call(s, 'POST', '/api/remote/tailscale', deviceHeaders);
    expect(enabled.status).toBe(200);
    expect(((await enabled.json()) as TailscaleAccess).url).toBe(`https://${DNS}`);
  });

  test('with token auth off the server refuses to expose itself to the tailnet', async () => {
    const node = fakeNode();
    const s = bootServer({ authToken: null, remote: { tailscale: serveFor(node) } });
    expect((await call(s, 'POST', '/api/remote/tailscale')).status).toBe(409);
    expect(node.serveCalls).toEqual([]);
  });
});
