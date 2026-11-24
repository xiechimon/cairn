import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { ANTIGRAVITY_ACP_ARGS } from '@cairn/shared/antigravity-install';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  antigravityLocalStatus,
  antigravityLogin,
} from '../../apps/desktop/src/antigravity-auth.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));

let fakeHome = '';

beforeEach(() => {
  fakeHome = join(tmpdir(), `cairn-agy-closed-pipe-${randomUUID()}`);
  vi.stubEnv('HOME', fakeHome);
  vi.stubEnv('CAIRN_AGY_PATH', process.execPath);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  rmSync(fakeHome, { recursive: true, force: true });
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
    setImmediate(() => child.emit('exit', 1, null));
  });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  return child;
}

test('the desktop status probe spawns full CLI ACP args and reports signed out when ACP closes stdin during initialize', async () => {
  closeStdinOnInitialize();
  await expect(antigravityLocalStatus()).resolves.toMatchObject({
    installed: true,
    loggedIn: false,
    canLogin: true,
  });
  expect(vi.mocked(spawn)).toHaveBeenCalledWith(
    process.execPath,
    expect.arrayContaining([...ANTIGRAVITY_ACP_ARGS, '--log-file']),
    expect.objectContaining({
      env: expect.objectContaining({ AGY_CLI_DISABLE_AUTO_UPDATE: '1' }),
    }),
  );
});

test('the desktop status probe ignores a legacy registry-pack install without runtime=agy-cli', async () => {
  vi.stubEnv('CAIRN_AGY_PATH', '');
  const versionDir = join(fakeHome, '.cairn', 'tools', 'antigravity', 'versions', '1.5.2');
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
  await expect(antigravityLocalStatus()).resolves.toMatchObject({
    installed: false,
    loggedIn: false,
  });
  expect(vi.mocked(spawn)).not.toHaveBeenCalled();
});

test('the desktop login returns an exit outcome and can be retried after ACP closes stdin', async () => {
  closeStdinOnInitialize();
  await expect(antigravityLogin()).resolves.toEqual({ ok: false, reason: 'exit' });
  closeStdinOnInitialize();
  await expect(antigravityLogin()).resolves.toEqual({ ok: false, reason: 'exit' });
});
