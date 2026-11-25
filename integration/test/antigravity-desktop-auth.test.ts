import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { ANTIGRAVITY_ACP_ARGS } from '@cairn/shared/antigravity-install';
import { createCredentialProfile, reapCredentialProfiles } from '@cairn/shared/credential-profile';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  antigravityLocalStatus,
  antigravitySignIn,
  stopAntigravityLogin,
} from '../../apps/desktop/src/antigravity-auth.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));

const tsxLoader = import.meta.resolve('tsx');
const workerPath = fileURLToPath(
  new URL('../../apps/desktop/src/antigravity-login-worker.ts', import.meta.url),
);
let home: string;
let appData: string;

beforeEach(() => {
  home = makeTestTempDir('agy-desktop-auth-');
  appData = makeTestTempDir('agy-desktop-data-');
  vi.stubEnv('HOME', home);
  vi.stubEnv('TMPDIR', home);
  vi.stubEnv('GEMINI_API_KEY', '');
  vi.stubEnv('CAIRN_AGY_PATH', process.execPath);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

function closeStdinOnInitialize() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  child.stdin.once('data', () => {
    child.stdin.destroy(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    setImmediate(() => child.emit('close', 1, null));
  });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  return child;
}

test('desktop status does not start ACP in the real profile', () => {
  expect(antigravityLocalStatus()).toMatchObject({
    installed: true,
    loggedIn: false,
    canLogin: true,
  });
  expect(spawn).not.toHaveBeenCalled();
});

test('desktop status ignores a legacy registry-pack install without runtime=agy-cli', () => {
  vi.stubEnv('CAIRN_AGY_PATH', '');
  const versionDir = join(home, '.cairn', 'tools', 'antigravity', 'versions', '1.5.2');
  mkdirSync(versionDir, { recursive: true });
  const par = join(versionDir, 'agy_acp_server.par');
  writeFileSync(par, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(
    join(versionDir, '.install-complete'),
    JSON.stringify({
      version: '1.5.2',
      url: 'https://dl.google.com/legacy.zip',
      archiveSha256: 'a'.repeat(64),
      binRelPath: 'agy_acp_server.par',
      binSha256: createHash('sha256').update('#!/bin/sh\nexit 0\n').digest('hex'),
      args: [],
      installedAt: 1,
    }),
  );
  expect(antigravityLocalStatus()).toMatchObject({
    installed: false,
    loggedIn: false,
  });
  expect(vi.mocked(spawn)).not.toHaveBeenCalled();
});

test('desktop credential channels do not forward local secrets to the renderer', () => {
  const main = readFileSync(new URL('../../apps/desktop/src/main.ts', import.meta.url), 'utf8');
  const preload = readFileSync(
    new URL('../../apps/desktop/src/preload.ts', import.meta.url),
    'utf8',
  );
  const oldChannels = /(?:local-providers:read|devin:import-key|antigravity:import-key)/g;
  expect(main.match(oldChannels)).toBeNull();
  expect(preload.match(oldChannels)).toBeNull();
});

test('sign-in returns the credential with full CLI ACP args and removes its private profile after exit', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  const credential = {
    kind: 'oauth-personal',
    token: `ya29.${'x'.repeat(64)}`,
    expiresAt: Date.now() + 60_000,
  };
  const pending = antigravitySignIn(appData);
  const args = vi.mocked(spawn).mock.calls[0]?.[1];
  const options = vi.mocked(spawn).mock.calls[0]?.[2] as
    | { env: NodeJS.ProcessEnv; cwd: string }
    | undefined;
  if (options === undefined) throw new Error('Expected the login process to start');
  const { env, cwd } = options;
  expect(args).toEqual(expect.arrayContaining([...ANTIGRAVITY_ACP_ARGS, '--log-file']));
  expect(env.AGY_CLI_DISABLE_AUTO_UPDATE).toBe('1');
  try {
    expect(env.HOME).toBe(cwd);
    expect(env.HOME).not.toBe(process.env.HOME);
    expect(dirname(dirname(cwd))).toBe(join(realpathSync(appData), 'credential-profiles'));
    expect(statSync(cwd).mode & 0o777).toBe(0o700);
    const dir = join(cwd, '.gemini', 'antigravity-acp');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'antigravity-oauth-token'),
      JSON.stringify({
        token: {
          access_token: credential.token,
          expiry: new Date(credential.expiresAt).toISOString(),
        },
      }),
    );
    child.stdout.write('{"id":1,"result":{}}\n');
    child.stdout.write('{"id":2,"result":{}}\n');
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalled());
    expect(existsSync(cwd)).toBe(true);
  } finally {
    child.emit('exit', 0, null);
    child.emit('close', 0, null);
    await pending;
  }
  await expect(pending).resolves.toEqual({ ok: true, credential });
  expect(existsSync(cwd)).toBe(false);
});

test('the desktop login returns an exit outcome and can be retried after ACP closes stdin', async () => {
  closeStdinOnInitialize();
  await expect(antigravitySignIn(appData)).resolves.toEqual({ ok: false, reason: 'exit' });
  closeStdinOnInitialize();
  await expect(antigravitySignIn(appData)).resolves.toEqual({ ok: false, reason: 'exit' });
});

test('cancellation and an ACP crash both remove the temporary profile without saving', async () => {
  for (const outcome of ['cancelled', 'exit']) {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        queueMicrotask(() => child.emit('close', 0, 'SIGTERM'));
        return true;
      }),
    });
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
    const started = antigravitySignIn(appData);
    const options = vi.mocked(spawn).mock.calls.at(-1)?.[2] as { cwd: string } | undefined;
    if (options === undefined) throw new Error('Expected the login process to start');
    const { cwd } = options;
    if (outcome === 'cancelled') await stopAntigravityLogin();
    else child.emit('close', 1, null);
    await expect(started).resolves.toEqual({ ok: false, reason: outcome });
    expect(existsSync(cwd)).toBe(false);
  }
});

test.each(['current', 'legacy', 'unknown'] as const)(
  'startup checks %s profile ownership before reaping a reused PID',
  (format) => {
    const abandoned = createCredentialProfile(appData);
    const active = createCredentialProfile(appData);
    const unrelated = join(appData, 'credential-profiles', 'unrelated');
    mkdirSync(unrelated);
    const ownerPath = join(dirname(abandoned.home), 'owner.json');
    const owner: { pid: number; startTimeVersion: number } = JSON.parse(
      readFileSync(ownerPath, 'utf8'),
    );
    writeFileSync(
      ownerPath,
      JSON.stringify({
        pid: owner.pid,
        startTime: process.platform === 'linux' ? '1' : 'Mon Nov 18 12:34:56 2002',
        ...(format === 'legacy'
          ? {}
          : { startTimeVersion: owner.startTimeVersion + Number(format === 'unknown') }),
      }),
    );
    try {
      reapCredentialProfiles(appData);
      expect(existsSync(abandoned.home)).toBe(format === 'unknown');
      expect(existsSync(active.home)).toBe(true);
      expect(existsSync(unrelated)).toBe(true);
    } finally {
      abandoned.cleanup();
      active.cleanup();
    }
  },
);

test('a successful sign-in does not accept credentials reached through a linked directory', async () => {
  const hostAcp = join(home, '.gemini', 'antigravity-acp');
  mkdirSync(hostAcp, { recursive: true });
  writeFileSync(
    join(hostAcp, 'antigravity-oauth-token'),
    JSON.stringify({
      token: {
        access_token: `ya29.${'x'.repeat(64)}`,
        expiry: new Date(Date.now() + 60_000).toISOString(),
      },
    }),
  );
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => {
      queueMicrotask(() => child.emit('close'));
      return true;
    },
  });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  const pending = antigravitySignIn(appData);
  const cwd = vi.mocked(spawn).mock.calls[0]?.[2]?.cwd;
  if (typeof cwd !== 'string') throw new Error('Expected a private profile');
  symlinkSync(join(home, '.gemini'), join(cwd, '.gemini'));
  child.stdout.write('{"id":1,"result":{}}\n{"id":2,"result":{}}\n');
  await expect(pending).resolves.toEqual({ ok: false, reason: 'failed' });
  expect(existsSync(hostAcp)).toBe(true);
});

test('the isolated login worker stops ACP and cleans up when desktop IPC disappears', async () => {
  const { home: profile } = createCredentialProfile(appData);
  const stopped = join(appData, 'acp-stopped');
  const { spawn: start } =
    await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const worker = start(
    process.execPath,
    [
      '--import',
      tsxLoader,
      workerPath,
      process.execPath,
      '-e',
      `const { writeFileSync } = require('node:fs');
    writeFileSync('synthetic-credential', 'fixture');
    process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(stopped)}, 'yes'); process.exit(0); });
    process.stdout.write('ready');
    setInterval(() => {}, 1000);`,
    ],
    {
      cwd: profile,
      env: { ...process.env, HOME: profile },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    },
  );
  const exited = once(worker, 'exit');
  try {
    if (worker.stdout === null) throw new Error('Expected a worker stdout pipe');
    expect(
      await Promise.race([once(worker.stdout, 'data').then(([data]) => String(data)), exited]),
    ).toBe('ready');
    expect(existsSync(join(profile, 'synthetic-credential'))).toBe(true);
  } finally {
    if (worker.connected) worker.disconnect();
    await exited;
  }
  expect(existsSync(stopped)).toBe(true);
  expect(existsSync(profile)).toBe(false);
});

test('supervised sign-in hands off the credential after ACP exits and the private profile is removed', async () => {
  const { spawn: start } =
    await vi.importActual<typeof import('node:child_process')>('node:child_process');
  vi.mocked(spawn).mockImplementationOnce((bin, args, opts) =>
    start(bin, ['--import', tsxLoader, ...(Array.isArray(args) ? args : [])], opts),
  );
  const bin = join(home, 'fixture-acp');
  const token = `ya29.${'y'.repeat(64)}`;
  const expiresAt = Date.now() + 60_000;
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const { id } = JSON.parse(line);
  if (id === 2) {
    fs.mkdirSync('.gemini/antigravity-acp', { recursive: true });
    fs.writeFileSync('.gemini/antigravity-acp/antigravity-oauth-token', JSON.stringify({ token: { access_token: '${token}', expiry: '${new Date(expiresAt).toISOString()}' } }));
  }
  process.stdout.write(JSON.stringify({ id, result: {} }) + '\\n');
});
`,
    { mode: 0o700 },
  );
  vi.stubEnv('CAIRN_AGY_PATH', bin);
  await expect(antigravitySignIn(appData, undefined, undefined, workerPath)).resolves.toEqual({
    ok: true,
    credential: { kind: 'oauth-personal', token, expiresAt },
  });
  const options = vi.mocked(spawn).mock.calls.at(-1)?.[2] as { cwd: string } | undefined;
  if (options === undefined) throw new Error('Expected the login worker to start');
  expect(existsSync(options.cwd)).toBe(false);
});
