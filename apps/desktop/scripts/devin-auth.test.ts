import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { devinCredentialsPath } from '@cairn/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { devinLogin } from '../src/devin-auth.js';

vi.mock('@cairn/shared/managed-bin', () => ({
  verifiedManagedBins: () => [{ command: process.execPath }],
}));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));

let home: string;
let appData: string;
const key = 'synthetic-devin-key';
const metadata = { id: 'fixture-account', label: 'Account' };

beforeEach(() => {
  const root = makeTestTempDir('devin-desktop-auth-');
  home = join(root, 'host-home');
  appData = join(root, 'app-data');
  mkdirSync(dirname(devinCredentialsPath(home)), { recursive: true });
  vi.stubEnv('HOME', home);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

function startLogin() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => {
      queueMicrotask(() => {
        child.emit('exit', 0, null);
        child.emit('close', 0, null);
      });
      return true;
    }),
  });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  const save = vi.fn(async () => metadata);
  const result = devinLogin(save, appData);
  child.stdout.write('{"id":1,"result":{}}\n');
  return { child, result, save, options: vi.mocked(spawn).mock.calls[0]?.[2] };
}

test('ACP success cannot save a pre-existing host credential', async () => {
  writeFileSync(devinCredentialsPath(home), `windsurf_api_key = "${key}"\n`);
  const { child, result, save } = startLogin();
  child.stdout.write('{"id":2,"result":{}}\n');
  expect(await result).toEqual({ ok: false, reason: 'no-key' });
  expect(save).not.toHaveBeenCalled();
});

test('an unrelated process changing the host credential cannot save it, even when ACP succeeds', async () => {
  const path = devinCredentialsPath(home);
  writeFileSync(path, 'windsurf_api_key = "synthetic-previous-key"\n');
  const { child, result, save } = startLogin();
  execFileSync(process.execPath, [
    '-e',
    'const fs = require("node:fs"); const [path, text] = process.argv.slice(1); fs.writeFileSync(path, text); const future = Date.now() / 1000 + 60; fs.utimesSync(path, future, future);',
    path,
    `windsurf_api_key = "${key}"\n`,
  ]);
  child.stdout.write('{"id":2,"result":{}}\n');
  expect(await result).toEqual({ ok: false, reason: 'no-key' });
  expect(save).not.toHaveBeenCalled();
});

test.each([
  ['{"result":{}}', true],
  ['{"result":null}', true],
  ['{"error":{"code":1}}', false],
  ['{}', false],
] as const)(
  'only a successful ACP response can save the credential from its own profile (%s)',
  async (response, success) => {
    const { child, result, save, options } = startLogin();
    const profile = options?.env?.HOME;
    if (profile === undefined) {
      child.stdout.write('{"id":2,"error":{"code":1}}\n');
      await result;
      throw new Error('Expected a private profile');
    }
    expect(options?.env?.XDG_DATA_HOME).toBe(join(profile, '.local', 'share'));
    const path = devinCredentialsPath(profile);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `windsurf_api_key = "${key}"\n`);
    child.stdout.write(`${JSON.stringify({ id: 2, ...JSON.parse(response) })}\n`);
    expect(await result).toEqual(
      success ? { ok: true, subscription: metadata } : { ok: false, reason: 'exit' },
    );
    if (success) expect(save).toHaveBeenCalledExactlyOnceWith(key);
    else expect(save).not.toHaveBeenCalled();
    expect(existsSync(profile)).toBe(false);
    expect(existsSync(devinCredentialsPath(home))).toBe(false);
  },
);
