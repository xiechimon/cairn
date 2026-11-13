import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { ACCESS_TOKEN_FILE_NAME, parseAccessTokenFile } from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';

vi.setConfig({ testTimeout: 60_000 });

const serverDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(serverDir, '../..');
const TOKEN = 'container-test-token-0123456789abcdef';
const RELAYED = { headers: { via: '1.1 relay.example' } };
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

const children: ChildProcess[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = makeTestTempDir('cairn-container-');
  dirs.push(dir);
  return dir;
}

interface Booted {
  child: ChildProcess;
  home: string;
  port: number;
  output: () => string;
  exited: Promise<number | null>;
}

async function boot(
  env: Record<string, string | undefined>,
  existingHome?: string,
): Promise<Booted> {
  const home = existingHome ?? tempDir();
  const webDir = tempDir();
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>cairn</title>');
  const port = await new Promise<number>((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const picked = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => done(picked));
    });
  });
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CAIRN_HOME: home,
      CAIRN_WEB_DIR: webDir,
      CAIRN_TOKEN: undefined,
      CAIRN_REQUIRE_TOKEN: undefined,
      CAIRN_AUTH: undefined,
      CAIRN_TAILSCALE_USERS: undefined,
      HOST: '127.0.0.1',
      PORT: String(port),
      ...env,
    },
  });
  children.push(child);
  let collected = '';
  child.stdout?.on('data', (chunk) => {
    collected += chunk;
  });
  child.stderr?.on('data', (chunk) => {
    collected += chunk;
  });
  const exited = new Promise<number | null>((done) => child.on('close', (code) => done(code)));
  return { child, home, port, output: () => collected, exited };
}

async function untilOnline(booted: Booted): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (booted.output().includes('cairn-server online')) return;
    await new Promise((tick) => setTimeout(tick, 100));
  }
  throw new Error(`server never came online:\n${booted.output()}`);
}

describe('container mode: CAIRN_REQUIRE_TOKEN', () => {
  test('flag on and no token: exits 1, names CAIRN_TOKEN, opens no port, writes no data', async () => {
    const booted = await boot({ CAIRN_REQUIRE_TOKEN: '1' });
    const code = await booted.exited;
    expect(code).toBe(1);
    expect(booted.output()).toMatch(/CAIRN_TOKEN/);
    expect(booted.output()).not.toContain('cairn-server online');
    expect(booted.output()).not.toMatch(CJK);
    expect(existsSync(join(booted.home, 'server'))).toBe(false);
  });

  test('flag on and empty token: still refuses (empty string counts as unset)', async () => {
    const booted = await boot({ CAIRN_REQUIRE_TOKEN: '1', CAIRN_TOKEN: '' });
    expect(await booted.exited).toBe(1);
  });

  test('flag on and token set: serves SPA shell open, /api/user/me 200 with token and 401 without, token never logged', async () => {
    const booted = await boot({ CAIRN_REQUIRE_TOKEN: '1', CAIRN_TOKEN: TOKEN });
    await untilOnline(booted);
    const base = `http://127.0.0.1:${booted.port}`;
    expect((await fetch(`${base}/app`)).status).toBe(200);
    expect((await fetch(`${base}/api/user/me`)).status).toBe(401);
    expect(
      (await fetch(`${base}/api/user/me`, { headers: { authorization: `Bearer ${TOKEN}x` } }))
        .status,
    ).toBe(401);
    expect(
      (await fetch(`${base}/api/user/me`, { headers: { authorization: `Bearer ${TOKEN}` } }))
        .status,
    ).toBe(200);
    expect(booted.output()).not.toContain(TOKEN);
  });

  test('local startup with a known token logs only guidance and CLI stdout provides a working link', async () => {
    const booted = await boot({ CAIRN_TOKEN: TOKEN });
    await untilOnline(booted);
    const output = await new Promise<string>((done, fail) => {
      const cli = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'token'], {
        cwd: resolve(serverDir, '../daemon'),
        env: {
          ...process.env,
          CAIRN_HOME: booted.home,
          CAIRN_TOKEN: TOKEN,
          HOST: '127.0.0.1',
          PORT: String(booted.port),
        },
      });
      children.push(cli);
      let stdout = '';
      cli.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      cli.on('error', fail);
      cli.on('close', (code) => (code === 0 ? done(stdout) : fail(new Error('token CLI failed'))));
    });
    expect(output).toContain(TOKEN);
    expect(output).not.toContain('#token=');
    expect(output).toContain('pairing code');
    expect(
      (
        await fetch(`http://127.0.0.1:${booted.port}/api/user/me`, {
          headers: { authorization: `Bearer ${TOKEN}` },
        })
      ).status,
    ).toBe(200);
    expect(booted.output().includes(TOKEN)).toBe(false);
    expect(booted.output().includes('#token=')).toBe(false);
    expect(booted.output()).toContain(
      'token auth enabled — run `cairn token` on this machine to print the owner token; other devices use a pairing code',
    );
  });

  test('flag off and no token on loopback: the server generates a token instead of serving open', async () => {
    const booted = await boot({});
    await untilOnline(booted);
    const base = `http://127.0.0.1:${booted.port}`;
    expect((await fetch(`${base}/api/user/me`, RELAYED)).status).toBe(401);
    expect(booted.output()).not.toMatch(CJK);
  });
});

function storedToken(home: string): string {
  const parsed = parseAccessTokenFile(readFileSync(join(home, ACCESS_TOKEN_FILE_NAME), 'utf8'));
  if (parsed === null) throw new Error('token file has no token');
  return parsed;
}

function lanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

describe('#2057 safe bare-server defaults on a real process', () => {
  test('fresh home, HOST/CAIRN_TOKEN/CAIRN_REQUIRE_TOKEN/CAIRN_AUTH all absent: loopback socket, 0600 token, guarded API', async () => {
    const booted = await boot({ HOST: undefined });
    await untilOnline(booted);
    const base = `http://127.0.0.1:${booted.port}`;
    expect((await fetch(`${base}/api/user/me`, RELAYED)).status).toBe(401);
    expect((await fetch(`${base}/api/user/me`)).status).toBe(401);
    const bootstrapped = await fetch(`${base}/api/auth/bootstrap`, { method: 'POST' });
    expect(bootstrapped.status).toBe(process.platform === 'linux' ? 200 : 401);
    const authCookie = (bootstrapped.headers.getSetCookie?.() ?? [])
      .map((value) => value.split(';')[0] ?? '')
      .find((value) => value.startsWith('cairn_auth='));
    expect(authCookie !== undefined).toBe(process.platform === 'linux');
    expect(
      (
        await fetch(`${base}/api/user/me`, {
          headers: authCookie === undefined ? {} : { cookie: authCookie },
        })
      ).status,
    ).toBe(process.platform === 'linux' ? 200 : 401);
    const tokenPath = join(booted.home, ACCESS_TOKEN_FILE_NAME);
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
    const token = storedToken(booted.home);
    expect(
      (await fetch(`${base}/api/user/me`, { headers: { authorization: `Bearer ${token}` } }))
        .status,
    ).toBe(200);
    expect(booted.output()).toContain('"host":"127.0.0.1"');
    expect(booted.output().includes(token)).toBe(false);
    expect(booted.output().includes('#token=')).toBe(false);
    const lan = lanAddress();
    if (lan !== null) {
      await expect(
        fetch(`http://${lan}:${booted.port}/api/user/me`, { signal: AbortSignal.timeout(3_000) }),
      ).rejects.toThrow();
    }
  });

  test('a restart on the same home keeps the stored token', async () => {
    const first = await boot({ HOST: undefined });
    await untilOnline(first);
    const token = storedToken(first.home);
    first.child.kill('SIGKILL');
    await first.exited;
    const second = await boot({ HOST: undefined }, first.home);
    await untilOnline(second);
    expect(storedToken(second.home)).toBe(token);
    expect(
      (
        await fetch(`http://127.0.0.1:${second.port}/api/user/me`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
  });

  test('HOST=0.0.0.0 without a token exits 1, names CAIRN_TOKEN, opens no port, writes no token', async () => {
    const booted = await boot({ HOST: '0.0.0.0' });
    expect(await booted.exited).toBe(1);
    expect(booted.output()).toMatch(/CAIRN_TOKEN/);
    expect(booted.output()).not.toContain('cairn-server online');
    expect(existsSync(join(booted.home, ACCESS_TOKEN_FILE_NAME))).toBe(false);
    expect(existsSync(join(booted.home, 'server'))).toBe(false);
  });

  test('HOST=0.0.0.0 with CAIRN_AUTH=off exits 1 and names CAIRN_AUTH', async () => {
    const booted = await boot({ HOST: '0.0.0.0', CAIRN_AUTH: 'off' });
    expect(await booted.exited).toBe(1);
    expect(booted.output()).toMatch(/CAIRN_AUTH=off/);
    expect(booted.output()).not.toContain('cairn-server online');
  });

  test('HOST=0.0.0.0 with CAIRN_AUTH=off and a token still exits 1', async () => {
    const booted = await boot({ HOST: '0.0.0.0', CAIRN_AUTH: 'off', CAIRN_TOKEN: TOKEN });
    expect(await booted.exited).toBe(1);
  });

  test('HOST=0.0.0.0 with a token starts and requires it', async () => {
    const booted = await boot({ HOST: '0.0.0.0', CAIRN_TOKEN: TOKEN });
    await untilOnline(booted);
    const base = `http://127.0.0.1:${booted.port}`;
    expect((await fetch(`${base}/api/user/me`, RELAYED)).status).toBe(401);
    expect(
      (await fetch(`${base}/api/user/me`, { headers: { authorization: `Bearer ${TOKEN}` } }))
        .status,
    ).toBe(200);
  });

  test('CAIRN_AUTH=off on loopback serves open, warns, and writes no token', async () => {
    const booted = await boot({ CAIRN_AUTH: 'off' });
    await untilOnline(booted);
    expect((await fetch(`http://127.0.0.1:${booted.port}/api/user/me`)).status).toBe(200);
    expect(booted.output()).toMatch(/CAIRN_AUTH=off/);
    expect(existsSync(join(booted.home, ACCESS_TOKEN_FILE_NAME))).toBe(false);
  });

  test('a forged Tailscale-User-Login from loopback grants nothing and the allowlist is reported ignored', async () => {
    const booted = await boot({ CAIRN_TAILSCALE_USERS: 'owner@example.com' });
    await untilOnline(booted);
    const base = `http://127.0.0.1:${booted.port}`;
    const res = await fetch(`${base}/api/user/me`, {
      headers: { 'tailscale-user-login': 'owner@example.com' },
    });
    expect(res.status).toBe(401);
    expect(booted.output()).toMatch(/CAIRN_TAILSCALE_USERS/);
  });

  test('the generated token still opens the SSE stream via ?token= and the exempt surfaces stay reachable', async () => {
    const booted = await boot({});
    await untilOnline(booted);
    const base = `http://127.0.0.1:${booted.port}`;
    const token = storedToken(booted.home);
    const teams = (await (
      await fetch(`${base}/api/teams`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as { id: string }[];
    const teamId = teams[0]?.id;
    expect(teamId).toBeTruthy();
    const controller = new AbortController();
    const ticket = (
      (await (
        await fetch(`${base}/api/auth/stream-ticket`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        })
      ).json()) as { ticket: string }
    ).ticket;
    const stream = await fetch(`${base}/api/teams/${teamId}/stream?ticket=${ticket}`, {
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    controller.abort();
    expect((await fetch(`${base}/api/teams/${teamId}/stream?token=wrong`, RELAYED)).status).toBe(
      401,
    );
    const callback = await fetch(`${base}/api/oauth/callback?code=x&state=bogus`, {
      redirect: 'manual',
    });
    expect(callback.status).toBe(302);
    const enroll = await fetch(`${base}/api/machine/enroll/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'exempt-probe' }),
    });
    expect(enroll.status).toBe(200);
  });
});

describe('container image definition', () => {
  test('runtime stage turns the refusal on, binds all interfaces and roots data in the volume', () => {
    const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/^ENV .*CAIRN_REQUIRE_TOKEN=1/m);
    expect(dockerfile).toMatch(/^ENV .*HOST=0\.0\.0\.0/m);
    expect(dockerfile).toMatch(/^ENV .*CAIRN_HOME=\/data/m);
    expect(dockerfile).toMatch(/^VOLUME \/data/m);
  });

  test('image never bakes a token and never ships the daemon', () => {
    const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');
    expect(dockerfile).not.toMatch(/CAIRN_TOKEN\s*=/);
    expect(dockerfile).not.toMatch(/apps\/daemon/);
  });
});
