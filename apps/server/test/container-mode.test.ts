import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

const serverDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(serverDir, '../..');
const TOKEN = 'container-test-token-0123456789abcdef';

const children: ChildProcess[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-container-'));
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

async function boot(env: Record<string, string | undefined>): Promise<Booted> {
  const home = tempDir();
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

  test('flag off and no token: default behaviour unchanged, server starts', async () => {
    const booted = await boot({});
    await untilOnline(booted);
    const base = `http://127.0.0.1:${booted.port}`;
    expect((await fetch(`${base}/api/user/me`)).status).toBe(200);
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

  test('railway.json builds the Dockerfile and health-checks the unauthenticated SPA shell', () => {
    const railway = JSON.parse(readFileSync(join(repoRoot, 'railway.json'), 'utf8'));
    expect(railway.build).toMatchObject({ builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' });
    expect(railway.deploy.healthcheckPath).toBe('/app');
  });
});
