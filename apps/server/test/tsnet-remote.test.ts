import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { ENV_VARS } from '@cairn/shared';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { loadConfig, type TsnetSettings } from '../src/config.js';
import type { SidecarProcess } from '../src/lib/tsnet-sidecar.js';
import { parseLocalStatus, startTsnetRemote, tsnetPathsOf } from '../src/services/tsnet-remote.js';
import { bootServer } from './helpers.js';

const TOKEN = 'tsnet-remote-token-0123456789abcdef';
const tmpDirs: string[] = [];
const stoppers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const stop of stoppers.splice(0)) await stop();
  vi.unstubAllEnvs();
});

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) releaseTestTempDir(dir);
});

function freshHome(): string {
  const home = makeTestTempDir('tn-');
  tmpDirs.push(home);
  return home;
}

class FakeSidecar extends EventEmitter implements SidecarProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly written: string[] = [];
  readonly stdin = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      this.written.push(chunk.toString('utf8'));
      done();
    },
  });

  constructor() {
    super();
    this.stdin.on('finish', () => queueMicrotask(() => this.emit('exit', 0, null)));
  }

  kill(): boolean {
    return true;
  }
}

function installBinary(home: string): string {
  const binaryPath = join(home, 'bin', 'tsnet-sidecar');
  mkdirSync(join(home, 'bin'), { recursive: true });
  writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n');
  chmodSync(binaryPath, 0o755);
  return binaryPath;
}

function settings(home: string, overrides: Partial<TsnetSettings> = {}): TsnetSettings {
  return {
    enabled: true,
    binaryPath: join(home, 'bin', 'tsnet-sidecar'),
    hostname: 'cairn',
    uploadLogs: false,
    controlUrl: null,
    ...overrides,
  };
}

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

interface Spawned {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  child: FakeSidecar;
}

function fakeSpawner(): {
  spawned: Spawned[];
  spawnProcess: (command: string, args: string[], env: NodeJS.ProcessEnv) => SidecarProcess;
} {
  const spawned: Spawned[] = [];
  return {
    spawned,
    spawnProcess: (command, args, env) => {
      const child = new FakeSidecar();
      spawned.push({ command, args, env, child });
      return child;
    },
  };
}

async function start(
  home: string,
  overrides: Partial<TsnetSettings> = {},
  parentEnv: NodeJS.ProcessEnv = { PATH: '/usr/bin', CAIRN_TOKEN: 'secret' },
  authToken: string | null = TOKEN,
) {
  const spawner = fakeSpawner();
  const s = bootServer({ authToken: TOKEN });
  const remote = await startTsnetRemote({
    settings: settings(home, overrides),
    homeDir: home,
    app: s.app,
    authToken,
    logger: silentLogger,
    parentEnv,
    spawnProcess: spawner.spawnProcess,
  });
  if (remote !== null) stoppers.push(() => remote.stop());
  return { remote, spawner, paths: tsnetPathsOf(home) };
}

function stubFreshInstall(home: string): void {
  vi.stubEnv(ENV_VARS.home, home);
  vi.stubEnv(ENV_VARS.token, '');
  vi.stubEnv(ENV_VARS.requireToken, '');
  vi.stubEnv(ENV_VARS.auth, '');
  vi.stubEnv('HOST', '');
  for (const name of [
    ENV_VARS.tsnet,
    ENV_VARS.tsnetBinary,
    ENV_VARS.tsnetHostname,
    ENV_VARS.tsnetUploadLogs,
    ENV_VARS.tsnetControlUrl,
  ]) {
    vi.stubEnv(name, '');
  }
}

describe('config: off unless explicitly enabled, log upload off unless opted in', () => {
  test('system tailscaled uses the same socket without a sidecar and reads a socket-only allowlist', () => {
    stubFreshInstall(freshHome());
    vi.stubEnv(ENV_VARS.tsnet, 'socket');
    vi.stubEnv(ENV_VARS.tailscaleUsers, ' owner@example.com, second@example.com ');
    expect(loadConfig().tsnet).toMatchObject({
      enabled: true,
      mode: 'socket',
      allowedLogins: ['owner@example.com', 'second@example.com'],
    });
  });
  test('a fresh install has tsnet disabled and log upload off', () => {
    const home = freshHome();
    stubFreshInstall(home);
    expect(loadConfig().tsnet).toEqual({
      enabled: false,
      binaryPath: join(home, 'bin', 'tsnet-sidecar'),
      hostname: 'cairn',
      uploadLogs: false,
      controlUrl: null,
    });
  });

  test.each(['1', 'true', 'yes'])('CAIRN_TSNET=%s enables it', (value) => {
    stubFreshInstall(freshHome());
    vi.stubEnv(ENV_VARS.tsnet, value);
    expect(loadConfig().tsnet.enabled).toBe(true);
  });

  test.each(['0', 'false', 'off', 'enabled', 'on'])(
    'CAIRN_TSNET=%s does not enable it',
    (value) => {
      stubFreshInstall(freshHome());
      vi.stubEnv(ENV_VARS.tsnet, value);
      expect(loadConfig().tsnet.enabled).toBe(false);
    },
  );

  test('enabling tsnet alone does not opt in to log upload', () => {
    stubFreshInstall(freshHome());
    vi.stubEnv(ENV_VARS.tsnet, '1');
    expect(loadConfig().tsnet.uploadLogs).toBe(false);
  });

  test('CAIRN_TSNET_UPLOAD_LOGS=1 is the explicit opt-in', () => {
    stubFreshInstall(freshHome());
    vi.stubEnv(ENV_VARS.tsnetUploadLogs, '1');
    expect(loadConfig().tsnet.uploadLogs).toBe(true);
  });

  test('binary, hostname and control URL come from their variables', () => {
    stubFreshInstall(freshHome());
    vi.stubEnv(ENV_VARS.tsnetBinary, '/opt/tsnet-sidecar');
    vi.stubEnv(ENV_VARS.tsnetHostname, 'my-cairn');
    vi.stubEnv(ENV_VARS.tsnetControlUrl, 'https://control.example');
    expect(loadConfig().tsnet).toMatchObject({
      binaryPath: '/opt/tsnet-sidecar',
      hostname: 'my-cairn',
      controlUrl: 'https://control.example',
    });
  });

  test('an invalid hostname fails config loading', () => {
    stubFreshInstall(freshHome());
    vi.stubEnv(ENV_VARS.tsnetHostname, 'not a hostname');
    expect(() => loadConfig()).toThrow();
  });
});

describe('default off: no process, no listener, no files', () => {
  test('disabled returns null, spawns nothing and creates nothing under the home', async () => {
    const home = freshHome();
    const spawner = fakeSpawner();
    const s = bootServer({ authToken: TOKEN });
    const remote = await startTsnetRemote({
      settings: settings(home, { enabled: false }),
      homeDir: home,
      app: s.app,
      authToken: TOKEN,
      logger: silentLogger,
      parentEnv: {},
      spawnProcess: spawner.spawnProcess,
    });
    expect(remote).toBeNull();
    expect(spawner.spawned).toHaveLength(0);
    expect(existsSync(tsnetPathsOf(home).root)).toBe(false);
    expect(existsSync(tsnetPathsOf(home).socketPath)).toBe(false);
  });
});

describe('enabled', () => {
  test.each(['9007199254740993', '18446744073709551615', '7'])(
    'preserves LocalAPI numeric UserID %s as its exact profile key',
    (userId) => {
      const body = `{"BackendState":"Running","Self":{"UserID":${userId}},"User":{"${userId}":{"LoginName":"owner@example.com"}}}`;
      expect(parseLocalStatus(body)).toMatchObject({ Self: { UserID: userId } });
    },
  );
  test.each([
    [
      'large numeric Self owner',
      parseLocalStatus(
        '{"BackendState":"Running","Self":{"UserID":9007199254740993},"User":{"9007199254740993":{"LoginName":"owner@example.com"},"9007199254740992":{"LoginName":"other@example.com"}}}',
      ),
      401,
    ],
    [
      'untagged Self owner',
      {
        BackendState: 'Running',
        Self: { UserID: 7, DNSName: 'cairn.tail.example.' },
        User: { '7': { LoginName: 'owner@example.com' }, '8': { LoginName: 'other@example.com' } },
      },
      401,
    ],
    [
      'tagged Self',
      {
        BackendState: 'Running',
        Self: { UserID: 7, Tags: ['tag:server'] },
        User: { '7': { LoginName: 'owner@example.com' } },
      },
      401,
    ],
    ['missing profile', { BackendState: 'Running', Self: { UserID: 7 }, User: {} }, 401],
    [
      'stopped backend',
      {
        BackendState: 'Stopped',
        Self: { UserID: 7 },
        User: { '7': { LoginName: 'owner@example.com' } },
      },
      401,
    ],
  ])('socket-only LocalAPI resolves %s', async (_name, status, expected) => {
    const home = freshHome();
    const s = bootServer({ authToken: TOKEN });
    const remote = await startTsnetRemote({
      settings: settings(home, { mode: 'socket' }),
      homeDir: home,
      app: s.app,
      authToken: TOKEN,
      logger: silentLogger,
      readLocalStatus: async () => status,
    });
    if (remote !== null) stoppers.push(() => remote.stop());
    const actual = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          socketPath: tsnetPathsOf(home).socketPath,
          path: '/api/teams',
          headers: { host: 'cairn.tail.example', 'Tailscale-User-Login': 'owner@example.com' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(actual).toBe(expected);
  });
  test.each([
    ['100.64.0.7', 401],
    ['fd7a:115c:a1e0::7', 401],
    ['100.64.0.9', 401],
  ])(
    'socket-only identity from source %s on the serving node gives %i',
    async (source, expected) => {
      const home = freshHome();
      const s = bootServer({ authToken: TOKEN });
      const remote = await startTsnetRemote({
        settings: settings(home, { mode: 'socket', allowedLogins: ['owner@example.com'] }),
        homeDir: home,
        app: s.app,
        authToken: TOKEN,
        logger: silentLogger,
        readLocalStatus: async () => ({
          BackendState: 'Running',
          Self: { UserID: 7, DNSName: 'cairn.tail.example.' },
          User: { '7': { LoginName: 'owner@example.com' } },
          TailscaleIPs: ['100.64.0.7', 'fd7a:115c:a1e0::7'],
        }),
      });
      if (remote !== null) stoppers.push(() => remote.stop());
      const actual = await new Promise<number>((resolve, reject) => {
        const req = request(
          {
            socketPath: tsnetPathsOf(home).socketPath,
            path: '/api/teams',
            headers: {
              host: 'cairn.tail.example',
              'Tailscale-User-Login': 'owner@example.com',
              'X-Forwarded-For': source,
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(actual).toBe(expected);
    },
  );
  const selfTrafficStatus = (home: string, source: string) =>
    new Promise<number>((resolve, reject) => {
      const req = request(
        {
          socketPath: tsnetPathsOf(home).socketPath,
          path: '/api/teams',
          headers: {
            host: 'cairn.tail.example',
            'Tailscale-User-Login': 'owner@example.com',
            'X-Forwarded-For': source,
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
  test('socket-only identity behind Serve is refused while the self addresses were never read', async () => {
    const home = freshHome();
    const s = bootServer({ authToken: TOKEN });
    const remote = await startTsnetRemote({
      settings: settings(home, { mode: 'socket', allowedLogins: ['owner@example.com'] }),
      homeDir: home,
      app: s.app,
      authToken: TOKEN,
      logger: silentLogger,
      readLocalStatus: async () => {
        throw new Error('LocalAPI unavailable');
      },
    });
    if (remote !== null) stoppers.push(() => remote.stop());
    expect(await selfTrafficStatus(home, '100.64.0.7')).toBe(401);
    expect(await selfTrafficStatus(home, '100.64.0.9')).toBe(401);
  });
  test('socket-only self addresses survive a failed LocalAPI refresh', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const home = freshHome();
    const s = bootServer({ authToken: TOKEN });
    let available = true;
    const remote = await startTsnetRemote({
      settings: settings(home, { mode: 'socket', allowedLogins: ['owner@example.com'] }),
      homeDir: home,
      app: s.app,
      authToken: TOKEN,
      logger: silentLogger,
      readLocalStatus: async () => {
        if (!available) throw new Error('LocalAPI unavailable');
        return {
          BackendState: 'Running',
          Self: { UserID: 7, DNSName: 'cairn.tail.example.' },
          User: { '7': { LoginName: 'owner@example.com' } },
          TailscaleIPs: ['100.64.0.7'],
        };
      },
    });
    if (remote !== null) stoppers.push(() => remote.stop());
    available = false;
    await vi.advanceTimersByTimeAsync(30_000);
    vi.useRealTimers();
    expect(remote?.status().ownerLogin).toBeNull();
    expect(await selfTrafficStatus(home, '100.64.0.7')).toBe(401);
    expect(await selfTrafficStatus(home, '100.64.0.9')).toBe(401);
  });
  test('socket-only startup needs no binary, spawns nothing and uses explicit allowlist when LocalAPI is unavailable', async () => {
    const home = freshHome();
    const s = bootServer({ authToken: TOKEN });
    const spawner = fakeSpawner();
    const remote = await startTsnetRemote({
      settings: settings(home, { mode: 'socket', allowedLogins: ['owner@example.com'] }),
      homeDir: home,
      app: s.app,
      authToken: TOKEN,
      logger: silentLogger,
      spawnProcess: spawner.spawnProcess,
      readLocalStatus: async () => {
        throw new Error('LocalAPI unavailable');
      },
    });
    if (remote !== null) stoppers.push(() => remote.stop());
    expect(remote?.status().state).toBe('ready');
    expect(spawner.spawned).toHaveLength(0);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          socketPath: tsnetPathsOf(home).socketPath,
          path: '/api/teams',
          headers: { host: 'cairn.tail.example', 'Tailscale-User-Login': 'owner@example.com' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(401);
  });

  test('ready owner metadata does not authenticate and stays refused after sidecar exit', async () => {
    const home = freshHome();
    installBinary(home);
    const { paths, spawner } = await start(home);
    const statusOf = () =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          {
            socketPath: paths.socketPath,
            path: '/api/teams',
            headers: { host: 'cairn.tail.example', 'Tailscale-User-Login': 'owner@example.com' },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
    expect(await statusOf()).toBe(401);
    spawner.spawned[0]?.child.stdout.write(
      `${JSON.stringify({ type: 'ready', dnsName: 'cairn.tail.example', ownerLogin: 'owner@example.com', selfTagged: false })}\n`,
    );
    expect(await statusOf()).toBe(401);
    spawner.spawned[0]?.child.emit('exit', 1, null);
    expect(await statusOf()).toBe(401);
  });
  test('creates a 0700 state area, an owner-only socket and starts the sidecar', async () => {
    const home = freshHome();
    installBinary(home);
    const { remote, spawner, paths } = await start(home);
    expect(remote?.status().state).toBe('starting');
    expect(statSync(paths.root).mode & 0o777).toBe(0o700);
    expect(statSync(paths.stateDir).mode & 0o777).toBe(0o700);
    expect(statSync(paths.socketPath).mode & 0o777).toBe(0o600);
    expect(spawner.spawned).toHaveLength(1);
    expect(spawner.spawned[0]?.command).toBe(join(home, 'bin', 'tsnet-sidecar'));
    expect(spawner.spawned[0]?.args).toEqual([
      '--state-dir',
      paths.stateDir,
      '--tailnet-upstream',
      `unix:${paths.socketPath}`,
      '--hostname',
      'cairn',
    ]);
  });

  test('auth on: the tailnet socket needs the token, and sidecar identity headers never replace it', async () => {
    const home = freshHome();
    installBinary(home);
    const { paths } = await start(home);
    const statusOf = (headers: Record<string, string>): Promise<number> =>
      new Promise<number>((resolve, reject) => {
        const req = request({
          socketPath: paths.socketPath,
          path: '/api/teams',
          headers: { host: 'cairn.tail.ts.net', ...headers },
        });
        req.on('response', (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end();
      });
    const identity = { 'Tailscale-User-Login': 'owner@example.com' };
    expect(await statusOf({})).toBe(401);
    expect(await statusOf(identity)).toBe(401);
    expect(await statusOf({ authorization: 'Bearer wrong' })).toBe(401);
    expect(await statusOf({ authorization: `Bearer ${TOKEN}`, ...identity })).toBe(200);
  });

  test('D116: log upload is off unless opted in, and that reaches the sidecar as args and env', async () => {
    const home = freshHome();
    installBinary(home);
    const { spawner } = await start(home);
    expect(spawner.spawned[0]?.args).not.toContain('--upload-logs');
    expect(spawner.spawned[0]?.env.TS_NO_LOGS_NO_SUPPORT).toBe('true');
    expect(spawner.spawned[0]?.env).not.toHaveProperty('CAIRN_TOKEN');
  });

  test('D116: the opt-in passes --upload-logs and drops the env disable', async () => {
    const home = freshHome();
    installBinary(home);
    const { spawner } = await start(home, { uploadLogs: true });
    expect(spawner.spawned[0]?.args).toContain('--upload-logs');
    expect(spawner.spawned[0]?.env).not.toHaveProperty('TS_NO_LOGS_NO_SUPPORT');
  });

  test('a ready event is exposed through status', async () => {
    const home = freshHome();
    installBinary(home);
    const { remote, spawner } = await start(home);
    spawner.spawned[0]?.child.stdout.write(
      `${JSON.stringify({ type: 'ready', ips: ['100.64.0.2'], dnsName: 'cairn.ts.net' })}\n`,
    );
    await vi.waitFor(() => expect(remote?.status().state).toBe('ready'));
    expect(remote?.status()).toMatchObject({ ips: ['100.64.0.2'], dnsName: 'cairn.ts.net' });
  });

  test('stop shuts the sidecar down and removes the socket', async () => {
    const home = freshHome();
    installBinary(home);
    const { remote, spawner, paths } = await start(home);
    const child = spawner.spawned[0]?.child;
    await remote?.stop();
    expect(child?.written.join('')).toBe('{"cmd":"shutdown"}\n');
    expect(existsSync(paths.socketPath)).toBe(false);
    expect(remote?.status().state).toBe('stopped');
  });

  test('a sidecar that cannot be spawned closes the tailnet listener', async () => {
    const home = freshHome();
    installBinary(home);
    const { remote, spawner, paths } = await start(home);
    expect(existsSync(paths.socketPath)).toBe(true);
    spawner.spawned[0]?.child.emit('error', new Error('spawn EACCES'));
    await vi.waitFor(() => expect(existsSync(paths.socketPath)).toBe(false));
    expect(remote?.status()).toMatchObject({ state: 'failed', lastError: 'spawn EACCES' });
  });
});

describe('failure modes leave the server running with no listener and no process', () => {
  test('token auth disabled refuses tailnet access: no spawn, no socket, no files', async () => {
    const home = freshHome();
    installBinary(home);
    const { remote, spawner, paths } = await start(home, {}, {}, null);
    expect(remote?.status().state).toBe('failed');
    expect(remote?.status().lastError).toMatch(/access token/);
    expect(spawner.spawned).toHaveLength(0);
    expect(existsSync(paths.root)).toBe(false);
  });

  test('a missing sidecar binary fails without spawning, listening or creating files', async () => {
    const home = freshHome();
    const { remote, spawner, paths } = await start(home);
    expect(remote?.status().state).toBe('failed');
    expect(remote?.status().lastError).toMatch(/sidecar binary/);
    expect(spawner.spawned).toHaveLength(0);
    expect(existsSync(paths.root)).toBe(false);
  });

  test('a binary that is not executable fails the same way', async () => {
    const home = freshHome();
    const binaryPath = installBinary(home);
    chmodSync(binaryPath, 0o644);
    const { remote, spawner } = await start(home);
    expect(remote?.status().state).toBe('failed');
    expect(spawner.spawned).toHaveLength(0);
  });

  test('a loosely-permissioned state directory is tightened to 0700', async () => {
    const home = freshHome();
    installBinary(home);
    const paths = tsnetPathsOf(home);
    mkdirSync(paths.stateDir, { recursive: true, mode: 0o755 });
    chmodSync(paths.root, 0o755);
    chmodSync(paths.stateDir, 0o755);
    const { remote } = await start(home);
    expect(remote?.status().state).toBe('starting');
    expect(statSync(paths.root).mode & 0o777).toBe(0o700);
    expect(statSync(paths.stateDir).mode & 0o777).toBe(0o700);
  });

  test('a state directory that is a symlink is refused', async () => {
    const home = freshHome();
    installBinary(home);
    const paths = tsnetPathsOf(home);
    const elsewhere = freshHome();
    mkdirSync(paths.root, { recursive: true, mode: 0o700 });
    symlinkSync(elsewhere, paths.stateDir);
    const { remote, spawner } = await start(home);
    expect(remote?.status()).toMatchObject({ state: 'failed' });
    expect(remote?.status().lastError).toMatch(/state/);
    expect(spawner.spawned).toHaveLength(0);
    expect(existsSync(paths.socketPath)).toBe(false);
  });

  test('a state path that is a regular file is refused', async () => {
    const home = freshHome();
    installBinary(home);
    const paths = tsnetPathsOf(home);
    mkdirSync(paths.root, { recursive: true, mode: 0o700 });
    writeFileSync(paths.stateDir, 'not a directory');
    const { remote, spawner } = await start(home);
    expect(remote?.status().state).toBe('failed');
    expect(spawner.spawned).toHaveLength(0);
  });

  test('a home so deep the unix socket path would not fit is refused with the reason', async () => {
    const home = join(freshHome(), 'd'.repeat(110));
    installBinary(home);
    const { remote, spawner } = await start(home);
    expect(remote?.status().state).toBe('failed');
    expect(remote?.status().lastError).toMatch(/socket path/);
    expect(spawner.spawned).toHaveLength(0);
  });
});
