import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { HostComputerProvider } from '../src/computer/host.js';
import { type ComputerProcessEvent, ComputerRefusal } from '../src/computer/provider.js';

let allocatedRoot: string;
let root: string;
let home: string;
let outside: string;

beforeEach(() => {
  allocatedRoot = makeTestTempDir('cairn-host-');
  root = realpathSync(allocatedRoot);
  home = path.join(root, 'home');
  outside = path.join(root, 'outside');
  mkdirSync(home);
  mkdirSync(outside);
});

afterEach(() => {
  expect(releaseTestTempDir(allocatedRoot)).toBe(true);
});

function provider(overrides: ConstructorParameters<typeof HostComputerProvider>[0] = {}) {
  return new HostComputerProvider({
    home,
    env: { PATH: process.env.PATH, HOME: home, CAIRN_MACHINE_TOKEN: 'daemon-secret' },
    killGraceMs: 200,
    ...overrides,
  });
}

async function run(
  host: HostComputerProvider,
  command: string,
  options: { cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {},
) {
  const events = await host.execute({
    argv: ['bash', '-c', command],
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    timeoutMs: options.timeoutMs ?? 5_000,
    signal: options.signal ?? new AbortController().signal,
  });
  const seen: ComputerProcessEvent[] = [];
  for await (const event of events) seen.push(event);
  const text = (kind: 'stdout' | 'stderr') =>
    seen.flatMap((e) => (e.kind === kind ? [e.text] : [])).join('');
  const exit = seen.find((e) => e.kind === 'exit');
  return { seen, stdout: text('stdout'), stderr: text('stderr'), exit };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)])
      .toString()
      .startsWith('Z');
  } catch {
    return false;
  }
}

async function expectGone(pids: number[]) {
  const deadline = Date.now() + 1_000;
  while (pids.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  expect(pids.filter(alive)).toEqual([]);
}

function readPids(file: string): number[] {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(Number);
}

const hasPython = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const hasSetsid = (() => {
  try {
    execFileSync('sh', ['-c', 'command -v setsid'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('host computer execute', () => {
  test('runs a command as a shell in the home folder and reports stdout, stderr and exit code', async () => {
    const result = await run(provider(), 'pwd; echo err >&2; exit 3');
    expect(result.stdout.trim()).toBe(home);
    expect(result.stderr).toBe('err\n');
    expect(result.exit).toEqual({ kind: 'exit', code: 3 });
  });

  test('cwd resolves relative to home, accepts ~ and ~/sub, and runs there', async () => {
    mkdirSync(path.join(home, 'work', 'app'), { recursive: true });
    expect((await run(provider(), 'pwd', { cwd: 'work/app' })).stdout.trim()).toBe(
      path.join(home, 'work', 'app'),
    );
    expect((await run(provider(), 'pwd', { cwd: '~/work' })).stdout.trim()).toBe(
      path.join(home, 'work'),
    );
    expect((await run(provider(), 'pwd', { cwd: '~' })).stdout.trim()).toBe(home);
  });

  test.each([
    ['..', '..'],
    ['../outside', '../outside'],
    ['an absolute path outside home', () => outside],
    ['a nested escape', 'work/../../outside'],
    ['a tilde escape', '~/../outside'],
  ])('refuses a cwd outside home: %s', async (_name, cwd) => {
    mkdirSync(path.join(home, 'work'));
    const target = typeof cwd === 'function' ? cwd() : cwd;
    await expect(run(provider(), 'touch escaped', { cwd: target })).rejects.toBeInstanceOf(
      ComputerRefusal,
    );
    expect(readdirSync(outside)).toEqual([]);
  });

  test('refuses a cwd reached through a symlink that leaves home, and a missing cwd', async () => {
    symlinkSync(outside, path.join(home, 'link'));
    await expect(run(provider(), 'touch escaped', { cwd: 'link' })).rejects.toThrow(
      /outside the home folder/,
    );
    await expect(run(provider(), 'true', { cwd: 'missing' })).rejects.toThrow(/existing directory/);
    expect(readdirSync(outside)).toEqual([]);
  });

  test('a symlink that stays inside home is a valid cwd', async () => {
    mkdirSync(path.join(home, 'real'));
    symlinkSync(path.join(home, 'real'), path.join(home, 'alias'));
    expect((await run(provider(), 'pwd', { cwd: 'alias' })).stdout.trim()).toBe(
      path.join(home, 'real'),
    );
  });

  test('the command does not inherit the daemon environment', async () => {
    const result = await run(
      provider(),
      'if [ -n "$CAIRN_COMPUTER_CALL" ]; then c=set; else c=; fi; echo "token=[$CAIRN_MACHINE_TOKEN] call=[$c]"',
    );
    expect(result.stdout.trim()).toBe('token=[] call=[set]');
  });

  test('agent-browser children keep the configured Chromium path and skip its version check', async () => {
    const result = await run(
      provider({
        env: {
          PATH: process.env.PATH,
          HOME: home,
          CAIRN_MACHINE_TOKEN: 'daemon-secret',
          AGENT_BROWSER_EXECUTABLE_PATH: '/usr/bin/chromium',
          AGENT_BROWSER_NO_VERSION_CHECK: '1',
        },
      }),
      'printf %s "$AGENT_BROWSER_EXECUTABLE_PATH|$AGENT_BROWSER_NO_VERSION_CHECK"',
    );
    expect(result.stdout).toBe('/usr/bin/chromium|1');
  });

  test('a command that exits before its timeout keeps its exit code while output drains', async () => {
    const result = await run(provider({ streamDrainMs: 1_500 }), 'echo completed; exit 0', {
      timeoutMs: 700,
    });
    expect(result.stdout).toBe('completed\n');
    expect(result.exit).toEqual({ kind: 'exit', code: 0 });
  });

  test('kills the whole process tree when the timeout passes', async () => {
    const pidFile = path.join(home, 'pids');
    const script = `for i in 1 2 3; do sleep 60 & echo $! >> ${pidFile}; done; (sleep 60 & echo $! >> ${pidFile}); sleep 60`;
    const started = Date.now();
    const result = await run(provider(), script, { timeoutMs: 500 });
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(result.exit).toMatchObject({ kind: 'exit', code: 124, reason: 'timeout' });
    expect(result.stderr).toContain('timed out after 500 ms');
    const pids = readPids(pidFile);
    expect(pids.length).toBe(4);
    await expectGone(pids);
  });

  test('kills a bounded nested tree of 20 sleepers, including ones that ignore SIGTERM', async () => {
    const pidFile = path.join(home, 'pids');
    const script = [
      `spawn() { if [ "$1" -gt 0 ]; then ( trap '' TERM; sleep 60 & echo $! >> ${pidFile}; spawn $(($1 - 1)) ) & fi; }`,
      'spawn 20',
      'sleep 60',
    ].join('\n');
    const result = await run(provider(), script, { timeoutMs: 700 });
    expect(result.exit).toMatchObject({ code: 124, reason: 'timeout' });
    const pids = readPids(pidFile);
    expect(pids.length).toBe(20);
    await expectGone(pids);
  });

  test.skipIf(!hasPython)(
    'kills a descendant that left the process group by starting a new session',
    async () => {
      const pidFile = path.join(home, 'pids');
      const script = `python3 -c "import os,time; os.setsid(); open('${pidFile}','a').write(str(os.getpid())+'\\n'); time.sleep(60)" & sleep 60`;
      const result = await run(provider(), script, { timeoutMs: 800 });
      expect(result.exit).toMatchObject({ code: 124 });
      await expectGone(readPids(pidFile));
    },
  );

  test.skipIf(process.platform !== 'linux' || !hasSetsid)(
    'kills an orphan that double-forked into a new session',
    async () => {
      const pidFile = path.join(home, 'pids');
      const script = `( setsid sh -c 'echo $$ >> ${pidFile}; exec sleep 60' & ) ; sleep 60`;
      const result = await run(provider(), script, { timeoutMs: 800 });
      expect(result.exit).toMatchObject({ code: 124 });
      await expectGone(readPids(pidFile));
    },
  );

  test('an abort signal kills the tree and ends with exit 130', async () => {
    const pidFile = path.join(home, 'pids');
    const controller = new AbortController();
    const pending = run(provider(), `sleep 60 & echo $! >> ${pidFile}; sleep 60`, {
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 300));
    controller.abort();
    const result = await pending;
    expect(result.exit).toMatchObject({ code: 130, reason: 'aborted' });
    await expectGone(readPids(pidFile));
  });

  test('a signal that is already aborted runs nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await run(provider(), `touch ${path.join(home, 'ran')}`, {
      signal: controller.signal,
    });
    expect(result.exit).toMatchObject({ code: 130 });
    expect(readdirSync(home)).toEqual([]);
  });

  test('a command that exits leaves a nohup background job running', async () => {
    const pidFile = path.join(home, 'pids');
    const host = provider();
    const result = await run(host, `nohup sleep 30 > /dev/null 2>&1 & echo $! > ${pidFile}`);
    expect(result.exit).toEqual({ kind: 'exit', code: 0 });
    const [pid] = readPids(pidFile);
    expect(alive(pid as number)).toBe(true);
    process.kill(pid as number, 'SIGKILL');
  });

  test('a background job that keeps the output pipe open does not hold the call open', async () => {
    const pidFile = path.join(home, 'pids');
    const started = Date.now();
    const result = await run(provider(), `sleep 30 & echo $! > ${pidFile}; echo done`);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(result.stdout).toBe('done\n');
    process.kill(readPids(pidFile)[0] as number, 'SIGKILL');
  });

  test('killAll stops commands that are still running', async () => {
    const host = provider();
    const pidFile = path.join(home, 'pids');
    const pending = run(host, `sleep 60 & echo $! >> ${pidFile}; sleep 60`);
    await new Promise((r) => setTimeout(r, 300));
    await host.killAll();
    const result = await pending;
    expect(result.exit).toBeDefined();
    await expectGone(readPids(pidFile));
  });

  test('a command that cannot start reports a stderr line and exit 1', async () => {
    const host = provider();
    const events = await host.execute({
      argv: ['definitely-not-a-binary-xyz'],
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });
    const seen: ComputerProcessEvent[] = [];
    for await (const event of events) seen.push(event);
    expect(seen.at(-1)).toEqual({ kind: 'exit', code: 1 });
  });
});

describe('host computer files', () => {
  test('writes and reads UTF-8 relative to home, creating parents', async () => {
    const host = provider();
    await host.writeFile('notes/日本語.txt', 'héllo ✓\n');
    expect(await host.readFile('notes/日本語.txt')).toBe('héllo ✓\n');
    expect(readFileSync(path.join(home, 'notes', '日本語.txt'), 'utf8')).toBe('héllo ✓\n');
  });

  test('a new file is private and an existing file keeps its mode; no temp file is left', async () => {
    const host = provider();
    await host.writeFile('new.txt', 'a');
    expect(statSync(path.join(home, 'new.txt')).mode & 0o777).toBe(0o600);
    writeFileSync(path.join(home, 'script.sh'), 'old');
    chmodSync(path.join(home, 'script.sh'), 0o750);
    await host.writeFile('script.sh', 'new');
    expect(statSync(path.join(home, 'script.sh')).mode & 0o777).toBe(0o750);
    expect(readFileSync(path.join(home, 'script.sh'), 'utf8')).toBe('new');
    expect(readdirSync(home).sort()).toEqual(['new.txt', 'script.sh']);
  });

  test.each([
    '../outside/x.txt',
    '/etc/cairn-test-write',
    'a/../../outside/x.txt',
    '~/../outside/x.txt',
  ])('refuses to write outside home: %s', async (target) => {
    await expect(provider().writeFile(target, 'x')).rejects.toBeInstanceOf(ComputerRefusal);
    expect(readdirSync(outside)).toEqual([]);
  });

  test('refuses reads and writes through a symlink that leaves home', async () => {
    writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, path.join(home, 'dirlink'));
    symlinkSync(path.join(outside, 'secret.txt'), path.join(home, 'filelink'));
    const host = provider();
    await expect(host.readFile('filelink')).rejects.toThrow(/outside the home folder/);
    await expect(host.readFile('dirlink/secret.txt')).rejects.toThrow(/outside the home folder/);
    await expect(host.writeFile('dirlink/new.txt', 'x')).rejects.toThrow(/outside the home folder/);
    await expect(host.writeFile('filelink', 'x')).rejects.toThrow(/outside the home folder/);
    expect(readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe('secret');
    expect(readdirSync(outside)).toEqual(['secret.txt']);
  });

  test('refuses a file over the read cap, a binary file and a missing file', async () => {
    const host = provider({ maxFileBytes: 16 });
    writeFileSync(path.join(home, 'big.txt'), 'x'.repeat(17));
    writeFileSync(path.join(home, 'bin'), Buffer.from([0xff, 0xfe, 0x00]));
    await expect(host.readFile('big.txt')).rejects.toThrow(/exceeds 16 bytes/);
    await expect(host.readFile('bin')).rejects.toThrow(/not valid UTF-8/);
    await expect(host.readFile('absent')).rejects.toThrow(/not found/);
    await expect(host.writeFile('big2.txt', 'y'.repeat(17))).rejects.toThrow(/exceeds 16 bytes/);
  });

  test('lists entries relative to home and skips links that leave home', async () => {
    mkdirSync(path.join(home, 'src'));
    writeFileSync(path.join(home, 'src', 'a.txt'), 'abc');
    writeFileSync(path.join(home, 'run.sh'), '#!/bin/sh');
    chmodSync(path.join(home, 'run.sh'), 0o755);
    symlinkSync(outside, path.join(home, 'leak'));
    const host = provider();
    expect(await host.listFiles('')).toEqual([
      { path: 'run.sh', kind: 'file', size: 9, executable: true },
      { path: 'src', kind: 'dir', size: expect.any(Number) },
    ]);
    expect(await host.listFiles('src')).toEqual([{ path: 'src/a.txt', kind: 'file', size: 3 }]);
    await expect(host.listFiles('../outside')).rejects.toBeInstanceOf(ComputerRefusal);
  });
});
