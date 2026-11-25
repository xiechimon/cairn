import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';

vi.setConfig({ testTimeout: 60_000 });

const serverDir = resolve(import.meta.dirname, '..');
const children: ChildProcess[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = makeTestTempDir('cairn-launchd-owner-');
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
      CAIRN_COORDINATOR_IN_SERVER: '0',
      CAIRN_TOKEN: undefined,
      CAIRN_REQUIRE_TOKEN: undefined,
      CAIRN_AUTH: undefined,
      CAIRN_MANAGED_BY: undefined,
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

describe('launchd server-owner.json lifecycle', () => {
  test('launchd-marked server writes server-owner.json on listen and removes it on SIGTERM when pid matches', async () => {
    const booted = await boot({ CAIRN_MANAGED_BY: 'launchd' });
    await untilOnline(booted);

    const ownerFile = join(booted.home, 'server-owner.json');
    expect(existsSync(ownerFile)).toBe(true);
    const owner = JSON.parse(readFileSync(ownerFile, 'utf8')) as {
      pid: number;
      port: number;
      origin: string;
      managedBy: string;
      startedAt: number;
    };
    expect(owner.pid).toBe(booted.child.pid);
    expect(owner.port).toBe(booted.port);
    expect(owner.origin).toBe(`http://127.0.0.1:${booted.port}`);
    expect(owner.managedBy).toBe('launchd');
    expect(typeof owner.startedAt).toBe('number');

    const probe = await fetch(`${owner.origin}/api/remote/descriptor`);
    expect(probe.ok).toBe(true);

    booted.child.kill('SIGTERM');
    expect(await booted.exited).toBe(0);
    expect(existsSync(ownerFile)).toBe(false);
  });

  test('launchd-marked server does not remove server-owner.json when overwritten by a newer pid', async () => {
    const booted = await boot({ CAIRN_MANAGED_BY: 'launchd' });
    await untilOnline(booted);

    const ownerFile = join(booted.home, 'server-owner.json');
    expect(existsSync(ownerFile)).toBe(true);
    const replacement = {
      pid: (booted.child.pid ?? 0) + 9999,
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      managedBy: 'launchd',
      startedAt: Date.now(),
    };
    writeFileSync(ownerFile, `${JSON.stringify(replacement, null, 2)}\n`, 'utf8');

    booted.child.kill('SIGTERM');
    expect(await booted.exited).toBe(0);
    expect(existsSync(ownerFile)).toBe(true);
    expect(JSON.parse(readFileSync(ownerFile, 'utf8'))).toEqual(replacement);
  });

  test('non-launchd server does not write server-owner.json', async () => {
    const booted = await boot({});
    await untilOnline(booted);

    const ownerFile = join(booted.home, 'server-owner.json');
    expect(existsSync(ownerFile)).toBe(false);

    booted.child.kill('SIGTERM');
    expect(await booted.exited).toBe(0);
    expect(existsSync(ownerFile)).toBe(false);
  });
});
