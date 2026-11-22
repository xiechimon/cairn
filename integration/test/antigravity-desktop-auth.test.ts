import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  antigravityLocalStatus,
  antigravityLogin,
} from '../../apps/desktop/src/antigravity-auth.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));

beforeEach(() => {
  vi.stubEnv('HOME', join(tmpdir(), `cairn-agy-closed-pipe-${randomUUID()}`));
  vi.stubEnv('CAIRN_AGY_PATH', process.execPath);
});

afterEach(() => {
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
    setImmediate(() => child.emit('exit', 1, null));
  });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  return child;
}

test('the desktop status probe reports signed out when ACP closes stdin during initialize', async () => {
  closeStdinOnInitialize();
  await expect(antigravityLocalStatus()).resolves.toMatchObject({
    installed: true,
    loggedIn: false,
    canLogin: true,
  });
});

test('the desktop login returns an exit outcome and can be retried after ACP closes stdin', async () => {
  closeStdinOnInitialize();
  await expect(antigravityLogin()).resolves.toEqual({ ok: false, reason: 'exit' });
  closeStdinOnInitialize();
  await expect(antigravityLogin()).resolves.toEqual({ ok: false, reason: 'exit' });
});
